// 测试装配的 **base**：真 cordis ctx + 一份行清单 → 装配面。
//
// 全 `support/` 只有这里 `new CordisContext`，也只有这里做「实例化 → 回填注入 → 绑事件字段 →
// 按派生名与上游别名发布 → onInit」。`host.ts` / `e2e-host.ts` / `e2e-client.ts`（各自的面）与
// `mountOnto`（本包的行清单）都是 `mountRows` 的薄封装：清单在调用方，装配只此一份。
//
// 为什么不用 `bootstrapApplication`：它总是**新起**一个 ctx，而 `src/__tests__` 的用例要先在同一个
// ctx 上挂自己的插件（`ctx.plugin(Storage)` / `SessionTurnOutline` / `new TokenMeter(ctx)`）
// 再把本包的行挂上去。两套装配的差别只有这一点，别的一律走这里。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@morlay/dsh-session/contract";
import { SessionStorePlugin } from "@morlay/dsh-session/server";
import { createSessionContext } from "@morlay/dsh-session/testing";
import { SessionProjectionRegistry } from "@morlay/dsh-session/server";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { EventEmitter, Injectable } from "@morlay/zephyr";
import type { Context, TokenClass } from "@morlay/zephyr";
import { injectPlaceholderOf, kFace, tokenMetaOf } from "@morlay/zephyr/testing";
import {
  SessionBranchRdb,
  SessionPersistenceRdb,
  SessionProjectionCacheRdb,
  SessionQueryRdb,
  StorageTakeoverDefault,
  type RdbConfig,
} from "@morlay/better-session";

/**
 * 运行环境替身：`AppEnv` 契约的完整实现，路径全部指向**本用例的临时目录**。
 *
 * 不用 `configure(AppEnvDefault, …)`：它的 `values` 是类字段初值，配置进不去，于是 `dataDir` 会落在
 * 进程 cwd 上，测试互相污染（同一 session id 的 header 在多次运行之间残留）。
 * `root` 是静态的：`AppEnv` 的字段初值在构造时求值，装配方必须在建行**之前**设好它。
 */
@Injectable()
export class FakeAppEnv extends AppEnv {
  // 本用例的临时根目录（`mountRows` 在建行之前设置）。
  static root = "";

  readonly values: AppEnvValues = {
    dataDir: FakeAppEnv.root,
    profileDir: FakeAppEnv.root,
  };

  readonly cacheDir = join(FakeAppEnv.root, "cache");

  readonly packageRoot = FakeAppEnv.root;

  readonly appBootDir = join(FakeAppEnv.root, "boot");

  readonly profileManifest = join(FakeAppEnv.root, "package.json");
}

/**
 * 装配出来的 ctx：真 cordis `Context`，加上按上游名发布的那几个服务。
 *
 * 本仓禁止 `declare module`，所以服务成员在这里显式声明；`get` / `provide` 也一样——cordis 靠模块
 * 增强把它们挂到 Context 上，`vendor/**` 不进我们的 program 时读不到。
 */
export type MountedContext = Context & {
  readonly sessions: SessionStore;
  readonly sessionPersistence: SessionPersistenceRdb;
  readonly sessionBranch: SessionBranchRdb;
  readonly sessionQuery: SessionQueryRdb;
  readonly sessionProjections: unknown;
  /** cordis 的 root fiber（`ctx.plugin(...)` 的返回值）；运行时本来就有，这里只是显式给出类型。 */
  readonly fiber: { dispose(): Promise<void> };
  get(name: string, strict?: boolean): unknown;
  provide(name: string, value: unknown): () => void;
};

/** 一份行：Provider 类，或直接给值（`{ provide: 令牌, useValue }`）。 */
export type RowEntry =
  | (new (config?: never) => unknown)
  | { readonly provide: object; readonly useValue: unknown };

/** `mountRows` 的选项。 */
export interface MountRowsOptions {
  /** 数据根（`AppEnv.dataDir`）。省略时开一个临时目录，随 `dispose` 删掉。 */
  readonly dataDir?: string;
  /**
   * 挂到**已有的** ctx 上（调用方先挂了自己的插件）。省略时新起一个。
   *
   * 用例要在持久化行之前 `ctx.plugin(Storage)` 这类场景走它——同一条装配路径，不是第二套。
   */
  readonly ctx?: MountedContext;
  /** 每行的 config，按 Provider 类定位（省略的行拿 `undefined`，由它的 `Config` 补默认值）。 */
  readonly config?: ReadonlyMap<object, unknown>;
  /** 建行**之前**发布的服务（按名字）：给「消费行要在装配期就读到它」的替身用例。 */
  readonly before?: (ctx: MountedContext) => void;
}

/** 一份装配：ctx、数据根、按令牌取服务，以及持有句柄。 */
export interface MountedRows {
  readonly ctx: MountedContext;
  /** 数据根。`bootstrapApplication` 的 `App` 没有这个字段，所以是可选的（旧 `mountRows` 才有）。 */
  readonly dataDir?: string;
  /** 按令牌取服务；没装配过就是装配错误（这里抛，不返回 `undefined`）。 */
  get<T>(token: TokenClass<T>): T;
  /** 同上，没有给 `undefined`。 */
  tryGet<T>(token: TokenClass<T>): T | undefined;
  /** 逆序跑 `onDispose`，再删掉自己开的数据根。 */
  readonly dispose: () => Promise<void>;
}

const roots: string[] = [];

/** 卸掉所有登记过的临时数据根（`afterAll(disposeAll)` 用）。 */
export async function disposeAll(): Promise<void> {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}

/**
 * 等价于源 spec 的 `const ctx = new Context();`：**唯一**一处真 cordis ctx。
 *
 * 用直接构造（`new SessionStore(ctx)` 在构造里注册 `sessions`）而不是 `ctx.plugin`：后者异步生效，
 * 而用例在下一行就要 `ctx.sessions.create(...)`。
 * @param options - `sessions: false` 给「会话存储由别人装」的场景（`mountLoopTestDependencies`
 *   会 `ctx.plugin(SessionStore)`；先注册一次就是同名重复注册）。
 * @returns 带 `get` / `provide` 类型面的 cordis ctx。
 */
export function createCtx(options: { readonly sessions?: boolean } = {}): MountedContext {
  // 造 ctx 与注册会话存储是**会话域** testing 面的事（`@morlay/dsh-session/testing` 的
  // `createSessionContext`）：本包只补自己的类型面，不再各写一遍 `new CordisContext()`。
  return createSessionContext(options) as unknown as MountedContext;
}

/**
 * 起一份装配：按清单顺序逐行「实例化 → 回填注入 → 绑事件字段 → 发布 → onInit」。
 *
 * 顺序即依赖：行必须排在它的提供者之后。同名服务已存在时不覆盖（`publish` 的规矩），
 * 于是「调用方已经装过的那一行」不会被顶掉。
 * @param rows - 行清单（Provider 类或 `useValue` 条目）。
 * @param options - 数据根、已有 ctx、每行 config、建行前的服务前置。
 * @returns 装配面；`dispose` 逆序跑 `onDispose` 并删掉自己开的数据根。
 */
export async function mountRows(
  rows: readonly RowEntry[],
  options: MountRowsOptions = {},
): Promise<MountedRows> {
  const owned = options.dataDir === undefined;
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "better-session-spec-")));
  if (owned) roots.push(dataDir);
  // `AppEnv` 的字段初值在构造时求值：先设根，再建行。
  FakeAppEnv.root = dataDir;

  // 清单决定装什么：`sessions` 由清单里的会话存储行注册，这里不预先顶一份。
  const ctx = options.ctx ?? createCtx({ sessions: false });
  // 运行环境与 logger：回填注入时按**上游注册名**读它们。
  publish(ctx, "app-env", new FakeAppEnv());
  publish(ctx, "logger", (ctx as unknown as { logger: unknown }).logger);
  options.before?.(ctx);

  const undo: Array<() => Promise<void>> = [];
  for (const entry of rows) {
    const config = typeof entry === "function" ? options.config?.get(entry) : undefined;
    undo.push(await mountRow(ctx, entry, config));
  }

  const tryGet = <T>(token: TokenClass<T>): T | undefined =>
    ctx.get(tokenMetaOf(token as unknown as object).name, false) as T | undefined;

  return {
    ctx,
    dataDir,
    tryGet,
    get<T>(token: TokenClass<T>): T {
      const found = tryGet<T>(token);
      if (found === undefined) {
        throw new Error(
          `没有提供者：${tokenMetaOf(token as unknown as object).name}（清单里没有它）`,
        );
      }
      return found;
    },
    dispose: async (): Promise<void> => {
      for (const dispose of [...undo].reverse()) await dispose().catch(() => undefined);
      if (owned) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

// 单行装配。顺序与 `bootstrapApplication` 一致：注入 → 事件字段 → 发布 → onInit。
async function mountRow(
  ctx: MountedContext,
  entry: RowEntry,
  config: unknown,
): Promise<() => Promise<void>> {
  if (typeof entry !== "function") {
    // 值条目：没有生命周期，只有「按契约名注册」这一步。
    publishToken(ctx, entry.provide, entry.useValue);
    return async () => undefined;
  }
  const normalizer = (entry as { Config?: (input?: unknown) => unknown }).Config;
  const normalized = typeof normalizer === "function" ? normalizer(config ?? {}) : config;
  const instance = new entry(normalized as never);
  fillInjects(ctx, instance);
  for (const key of Object.keys(instance as object)) {
    const value = (instance as Record<string, unknown>)[key];
    if (value instanceof EventEmitter) value.onInit(ctx as never);
  }
  const lifecycle = instance as {
    onInit?(ctx: unknown): Promise<void> | void;
    onDispose?(): Promise<void> | void;
  };
  await lifecycle.onInit?.(ctx);
  // 适配行（`fromCordis`）的契约面在上游插件里，`onInit` 之后才有：按契约名发布的是**面**，
  // 不是包着它的那一行（`bootstrapApplication` 的 `bindFace` 同一口径）。发布因此排在 `onInit` 之后
  // ——先发包装行的话，「已有就跳过」会让真面永远发不出去。
  const face = (instance as Record<symbol, unknown>)[kFace];
  publishToken(ctx, entry, face ?? instance);
  return async () => {
    await lifecycle.onDispose?.();
  };
}

// 回填注入：字段上是 `inject(...)` 的占位，按令牌派生名从 ctx 取。
function fillInjects(ctx: MountedContext, instance: unknown): void {
  if (typeof instance !== "object" || instance === null) return;
  for (const key of Object.keys(instance)) {
    const placeholder = injectPlaceholderOf((instance as Record<string, unknown>)[key]);
    if (placeholder === undefined) continue;
    const meta = tokenMetaOf(placeholder.token);
    const resolved = ctx.get(meta.name, false);
    if (resolved === undefined && placeholder.mode === "one") {
      throw new Error(`没有提供者：${meta.name}（${instance.constructor.name} 需要它）`);
    }
    (instance as Record<string, unknown>)[key] = resolved;
  }
}

/**
 * 按**令牌派生名**发布一份服务，并按 `@Injectable({ name })` 的别名再发一份。
 *
 * 别名是给上游用的：上游按驼峰严格读（`ctx.sessionPersistence`），只发派生名时它拿到 `undefined`
 * 然后**静默降级**——「只发派生名」的 bug 在测试里就抓不到。与 `bootstrap.ts` 同一机制。
 * @param ctx - 装配用的 ctx。
 * @param token - 契约令牌（或 Provider 类 / 值条目里的令牌）。
 * @param value - 服务实例。
 */
export function publishToken(ctx: MountedContext, token: object, value: unknown): void {
  const meta = tokenMetaOf(token);
  publish(ctx, meta.name, value);
  if (meta.alias === undefined) return;
  publish(ctx, meta.alias, value);
  // `ctx.<名字>` 的读法（源 spec 的 `ctx.sessionPersistence`）走属性面，不走 `get`。
  Object.assign(ctx, { [meta.alias]: value });
}

/**
 * 按名字发布一份服务（已有就跳过，避免 "已注册" 抛错）。
 * @param ctx - cordis 上下文。
 * @param name - 上游注册名（驼峰）或我们的派生名。
 * @param value - 服务实例。
 * @returns 恒等桩（卸载由装配方负责）。
 */
export function publish(ctx: MountedContext, name: string, value: unknown): () => void {
  if (value === undefined) return () => undefined;
  const store = (
    ctx as unknown as {
      reflect: { get(n: string, s?: boolean): unknown; provide(n: string, v: unknown): unknown };
    }
  ).reflect;
  if (store.get(name, false) !== undefined) return () => undefined;
  store.provide(name, value);
  return () => undefined;
}

// ---------------------------------------------------------------------------
// 本包的行清单（`mountOnto` / `mount`）：决定挂哪几行、各自的 config。
// ---------------------------------------------------------------------------

/** 挂本包的行时可以调的旋钮。 */
export interface MountOptions {
  // 落盘配置（`path: ":memory:"` 原样透传给 sqlite）。
  readonly config?: RdbConfig;
  // 数据根（`AppEnv.dataDir`）；省略时开一个临时目录，随 `dispose` 删掉。
  readonly root?: string;
  // 是否挂投影注册表：默认挂；传 `false` 时由调用方自己给替身（测"上游字段改名"那种形状）。
  readonly projections?: boolean;
  // 挂完之后往 ctx 上塞服务（源 spec 的 `ctx.provide(...)` 前置用法）。
  readonly provide?: (ctx: MountedContext) => void;
  // 是否挂投影检查点行：默认挂。多个实例共用一个库文件的并发写用例要关掉——它的自动写会把
  // 事件落库提前到每个 tick，跨实例抢 SQLite 写锁（那类用例量的是持久化本身，不是缓存）。
  readonly projectionCache?: boolean;
}

/** 一份本包的行装配。 */
export interface MountedRow {
  readonly ctx: MountedContext;
  readonly root: string;
  readonly persistence: SessionPersistenceRdb;
  readonly dispose: () => Promise<void>;
  // 与 cordis 的 `ctx.plugin(...)` 同形：源 spec 拿它只调 `fiber.dispose()`。
  readonly fiber: { dispose(): Promise<void> };
}

/**
 * 把本包的行挂到一个已有的 cordis ctx 上。
 *
 * 上游的两个服务（会话存储、投影注册表）是 cordis 的 `Service`：它们要在构造里拿到 ctx 才注册自己，
 * 所以先按「已经有了就复用」的规矩建好，再作为值条目进 `mountRows` 的清单。
 * @param ctx - 已有的 cordis ctx（`createCtx()` 的产物）。
 * @param options - 落盘配置、数据根、是否挂投影注册表 / 检查点、额外的服务前置。
 * @returns ctx、数据根、落盘实现与卸载函数。
 */
export async function mountOnto(
  ctx: MountedContext,
  options: MountOptions = {},
): Promise<MountedRow> {
  // 会话存储：已经在这个 ctx 上装过就复用（`createCtx` 装过；`mountLoopTestDependencies`
  // 也会 `ctx.plugin(SessionStore)`）。契约派生名 `session-store` 也要发：我们的行注入的是令牌。
  const sessionStore =
    (ctx.get("sessions", false) as SessionStore | undefined) ??
    new SessionStorePlugin(ctx as never);

  // 投影注册表：调用方已经装过就只补我们的令牌派生名——我们的行注入的是令牌，不是上游驼峰名。
  const projections =
    options.projections === false
      ? undefined
      : ((ctx.get("sessionProjections", false) as unknown) ??
        new SessionProjectionRegistry(ctx as never));

  const rows: RowEntry[] = [
    { provide: SessionStore as unknown as object, useValue: sessionStore },
    ...(projections === undefined
      ? []
      : [{ provide: SessionProjectionStore as unknown as object, useValue: projections }]),
    // 顺序 = 依赖：持久化最前（其余行都读它）；storage 接管紧随（它拿同一个库的句柄），
    // 检查点排在接管之后（检查点行与 KV 域落同一个库）。
    SessionPersistenceRdb as RowEntry,
    ...(ctx.get("storage", false) === undefined ? [] : [StorageTakeoverDefault as RowEntry]),
    ...(projections === undefined || options.projectionCache === false
      ? []
      : [SessionProjectionCacheRdb as RowEntry]),
    SessionBranchRdb as RowEntry,
    SessionQueryRdb as RowEntry,
  ];

  const mounted = await mountRows(rows, {
    ...(options.root === undefined ? {} : { dataDir: options.root }),
    ctx,
    config: new Map<object, unknown>([[SessionPersistenceRdb, options.config]]),
  });

  const persistence = mounted.tryGet(SessionPersistence) as SessionPersistenceRdb;
  options.provide?.(ctx);
  return {
    ctx,
    root: mounted.dataDir ?? "",
    persistence,
    dispose: mounted.dispose,
    fiber: { dispose: mounted.dispose },
  };
}

/**
 * 起一份独立装配（不需要在同一 ctx 上挂别的插件时用）。
 * @param options - 落盘配置、数据根、是否挂投影注册表、额外的服务前置。
 * @returns 装配结果。
 */
export async function mount(options: MountOptions = {}): Promise<MountedRow> {
  return await mountOnto(createCtx(), options);
}
