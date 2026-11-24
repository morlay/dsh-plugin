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
import { onTestFinished } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@morlay/dsh-session/contract";
import { SessionStorePlugin } from "@morlay/dsh-session/server";
import { createSessionContext } from "@morlay/dsh-session/testing";
import { SessionProjectionRegistry } from "@morlay/dsh-session/server";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { AppEnv } from "@morlay/zephyr-app";
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { bootstrapApplication } from "@morlay/zephyr";
import type { App, Context, ProviderEntry, TokenClass } from "@morlay/zephyr";
import {
  SessionBranchRdb,
  SessionBranchingRdb,
  SessionPersistenceRdb,
  SessionProjectionCacheRdb,
  SessionQueryRdb,
  StorageTakeoverDefault,
  type RdbConfig,
} from "@morlay/session-rdb";

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
  // `provide` 收成**令牌面**（`TokenClass<unknown>`）而不是 `object`：这一位只放令牌，
  // 放错东西（实例、字面量）时当场报错；令牌具体是什么由契约自己管，这里不需要知道。
  | { readonly provide: TokenClass<unknown>; readonly useValue: unknown };

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
  /**
   * 建行**之前**就发布的服务（值条目，排在清单最前）：给「消费行在装配期注入它」的替身用例。
   *
   * 写法就是装配清单本身的写法（`{ provide: 令牌, useValue }`）——测试不拼服务名、也不碰令牌表：
   * 名字由装配器按令牌算，`@Injectable({ name })` 的别名也由它一并发布。
   */
  readonly services?: RowList;
}

/** `mountRows` 收的清单：本包的窄条目，或装配器自己的条目（`clientWithTransport` / `provide*` 的产物）。 */
export type RowList = readonly (RowEntry | ProviderEntry)[];

/** 一份装配：ctx、数据根、装配器本身，以及持有句柄。 */
export interface MountedRows {
  readonly ctx: MountedContext;
  /**
   * 装配器本身（`get` / `tryGet` / `dispose`）。
   *
   * 给「要把这份装配当 `App` 交给双端工厂」的场景：`clientWithTransport(app, …)` /
   * `hostInvokerOf(app)` 收的都是 `App`，测试支撑不该再造一个平行形状。
   *
   * 卸载仍走本接口的 `dispose`（它顺带删临时数据根），不要直接 `app.dispose()`。
   */
  readonly app: App;
  /** 数据根。`bootstrapApplication` 的 `App` 没有这个字段，所以是可选的（旧 `mountRows` 才有）。 */
  readonly dataDir?: string;
  /** 按令牌取服务；没装配过就是装配错误（这里抛，不返回 `undefined`）。 */
  get<T>(token: TokenClass<T>): T;
  /** 同上，没有给 `undefined`。 */
  tryGet<T>(token: TokenClass<T>): T | undefined;
  /** 逆序跑 `onDispose`，再删掉自己开的数据根。 */
  readonly dispose: () => Promise<void>;
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
  rows: RowList,
  options: MountRowsOptions = {},
): Promise<MountedRows> {
  const owned = options.dataDir === undefined;
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "better-session-spec-")));
  // 自己开的数据根绑到**本用例**：测试结束（含失败）就删，不留模块级清单等 afterAll 收。
  if (owned) onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
  // 运行环境实例在**建行之前**造好：`AppEnv` 的字段在构造时求值，值条目随清单一起进装配。
  const appEnv = createTestingAppEnv({ root: dataDir });

  // 清单决定装什么：`sessions` 由清单里的会话存储行注册，这里不预先顶一份。
  const ctx = options.ctx ?? createCtx({ sessions: false });
  publish(ctx, "logger", (ctx as unknown as { logger: unknown }).logger);

  // 装配只有一处实现：`bootstrapApplication`（传入已有 ctx，不另起一棵树）。
  // 测试曾经平行实现过一套「实例化 → 回填注入 → 发布 → onInit」，名字/令牌规则一变就要改两处。
  // 运行环境与调用方给的服务是**值条目**、排在最前：后面那些行在装配期注入它们时它们就在场。
  // 名字（派生名与 `@Injectable({ name })` 的别名）由装配器按令牌算，测试不拼名字。
  const app = await bootstrapApplication({
    providers: [
      { provide: AppEnv, useValue: appEnv },
      ...(options.services ?? []),
      ...rows.map((entry) => {
        const config = typeof entry === "function" ? options.config?.get(entry) : undefined;
        return config === undefined ? entry : ({ provide: entry, config } as never);
      }),
    ],
    ctx: ctx as never,
  });

  return {
    ctx,
    app,
    dataDir,
    tryGet: <T>(token: TokenClass<T>): T | undefined => app.tryGet(token),
    get<T>(token: TokenClass<T>): T {
      return app.get(token);
    },
    dispose: async (): Promise<void> => {
      await app.dispose();
      if (owned) await rm(dataDir, { recursive: true, force: true });
    },
  };
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
  // 建行**之前**就发布的服务（值条目）：本包的可选能力走 `inject.optional(契约令牌)`，回填注入
  // 发生在建行时，所以"要在装配期就被拿到的替身"必须走这里（`provide` 是挂完之后，喂不到注入）。
  readonly services?: readonly RowEntry[];
  // 是否挂投影检查点行：默认挂。多个实例共用一个库文件的并发写用例要关掉——它的自动写会把
  // 事件落库提前到每个 tick，跨实例抢 SQLite 写锁（那类用例量的是持久化本身，不是缓存）。
  readonly projectionCache?: boolean;
}

/** 一份本包的行装配。 */
export interface MountedRow {
  readonly ctx: MountedContext;
  readonly root: string;
  readonly persistence: SessionPersistenceRdb;
  /** 按契约令牌取本装配里的服务（新加的行不必一个个挂到本接口上）。 */
  readonly get: <T>(token: TokenClass<T>) => T;
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
    { provide: SessionStore, useValue: sessionStore },
    ...(projections === undefined
      ? []
      : [{ provide: SessionProjectionStore, useValue: projections }]),
    // 顺序 = 依赖：持久化最前（其余行都读它）；storage 接管紧随（它拿同一个库的句柄），
    // 检查点排在接管之后（检查点行与 KV 域落同一个库）。
    SessionPersistenceRdb as RowEntry,
    ...(ctx.get("storage", false) === undefined ? [] : [StorageTakeoverDefault as RowEntry]),
    ...(projections === undefined || options.projectionCache === false
      ? []
      : [SessionProjectionCacheRdb as RowEntry]),
    SessionBranchRdb as RowEntry,
    SessionBranchingRdb as RowEntry,
    SessionQueryRdb as RowEntry,
  ];

  const mounted = await mountRows(rows, {
    ...(options.root === undefined ? {} : { dataDir: options.root }),
    ctx,
    config: new Map<object, unknown>([[SessionPersistenceRdb, options.config]]),
    ...(options.services === undefined ? {} : { services: options.services }),
  });

  const persistence = mounted.tryGet(SessionPersistence) as SessionPersistenceRdb;
  options.provide?.(ctx);
  return {
    ctx,
    root: mounted.dataDir ?? "",
    persistence,
    get: <T>(token: TokenClass<T>): T => mounted.get(token),
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
