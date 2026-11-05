// 装配入口：清单 → cordis 插件序列 → App。
//
// 运行期语义全归 cordis：服务注册走 `ctx.provide(name, value)`，依赖读取走 `ctx.get(name)`，
// 生命周期走 `ctx.effect`。这里只做三件事：实例化、回填注入、按清单顺序挂 onInit。
import { Context as CordisContext } from "@deepseek-ai/cordis/src/context.ts";
import type { Context, Lifecycle, Newable, TokenClass } from "./injection.ts";
import type { ProvidersCoverage } from "./coverage.ts";
import { Debugger, DebuggerDefault, type DebugSnapshot } from "./debugger.ts";
import { EventEmitter } from "./event-emitter.ts";
import { Logger } from "./logger.ts";
import { configOf, entryOf, type ProviderEntry, type ProviderList } from "./provider.ts";
import {
  injectPlaceholderOf,
  isValueToken,
  kAdapted,
  kFace,
  kMounted,
  providerOfPlugin,
  rowNameOf,
  tokenMetaOf,
  tokenNamed,
} from "./token.ts";

/** 装配选项。 */
export interface BootstrapOptions {
  readonly providers: ProviderList;
  /** 启动预算；**当前 bootstrap 尚未消费**（保留字段，清理前不要依赖它）。 */
  readonly timeoutMs?: number;
}

/** 装配结果。 */
export interface App {
  /** 装配用的 cordis 根 ctx。 */
  readonly ctx: CordisContext;
  /**
   * 按契约取服务；没有就是装配错误（这里抛，不返回 `undefined`）。
   * @param token - 契约。
   * @returns 实例。
   */
  get<T>(token: TokenClass<T>): T;
  /**
   * 按契约取服务，没有给 `undefined`。
   * @param token - 契约。
   * @returns 实例或 `undefined`。
   */
  tryGet<T>(token: TokenClass<T>): T | undefined;
  /**
   * 多值令牌的全部实现（按清单顺序）。
   * @param token - 多值契约。
   * @returns 实例数组。
   */
  getAll<T>(token: TokenClass<T>): T[];
  /** 卸载：逆序跑 `onDispose`，再销毁 cordis 根 ctx。 */
  dispose(): Promise<void>;
}

/**
 * 按清单装配一个应用。
 * @param options - 清单与启动上限。
 * @returns 装配结果。
 */
export async function bootstrapApplication<const L extends ProviderList>(
  options: { readonly providers: L; readonly timeoutMs?: number } & ProvidersCoverage<L>,
): Promise<App> {
  const ctx = new CordisContext();
  // 诊断快照：装配过程一直在写，`app.get(Debugger).diagnostics()` 读到的就是最终结果。
  let snapshot: DebugSnapshot = { rows: [], names: [], tokens: [] };
  const declared = options.providers.map((entry) => entryOf(entry));
  const entries: ProviderList = [
    ...options.providers,
    // 默认条目只在清单里**没有**该令牌时追加：装配面要替换（测试替身、`without`）时以清单为准。
    ...(declared.includes(Debugger as unknown as ReturnType<typeof entryOf>)
      ? []
      : [
          { provide: Debugger as unknown as object, useValue: new DebuggerDefault(() => snapshot) },
        ]),
    // cordis 的 logger 是原生属性，不是可构造的上游类：直接把它接到契约上。
    ...(declared.includes(Logger as unknown as ReturnType<typeof entryOf>)
      ? []
      : [
          {
            provide: Logger as unknown as object,
            useValue: (ctx as unknown as { logger: unknown }).logger,
          },
        ]),
  ];
  const rowState: { name: string; state: "started" | "failed"; reason?: string }[] = [];
  const instances = new Map<object, unknown>();
  const multi = new Map<object, unknown[]>();
  const rows: Array<{
    readonly name: string;
    readonly token: object;
    readonly instance: Lifecycle & object;
  }> = [];

  // 一、构造实例并登记。依赖此刻还是占位，不读。
  for (const entry of entries) {
    assertDslEntry(entry);
    const impl = (providerOfPlugin(entry) ?? entryOf(entry)) as typeof entryOf extends never
      ? never
      : ReturnType<typeof entryOf>;
    const meta = tokenMetaOf(impl as unknown as object);
    const instance = instantiate(entry, impl);
    if (meta.multi) {
      const list = multi.get(meta.token) ?? [];
      list.push(instance);
      multi.set(meta.token, list);
    } else {
      instances.set(meta.token, instance);
      // 适配行的契约面由上游插件发布（`mount` 之后才拿到），此刻不抢先注册。
      const adapted = (instance as Record<symbol, unknown>)[kAdapted] === true;
      if (!adapted) {
        // 服务注册走 cordis 自己的 store：派生名 + （声明过的话）上游别名。
        const store = ctx.reflect as unknown as {
          provide(name: string, value: unknown): void;
          get(name: string, strict?: boolean): unknown;
        };
        store.provide(meta.name, instance);
        // `@Injectable({ name })` 的别名：上游按驼峰名严格读（`ctx.sessionPersistence` / `ctx.settings`），
        // 只发派生名时它们拿到 `undefined` 然后**静默降级**。已存在就跳过（适配行的名字由上游自己注册）。
        if (
          meta.alias !== undefined &&
          meta.alias !== meta.name &&
          store.get(meta.alias, false) === undefined
        ) {
          store.provide(meta.alias, instance);
        }
      }
    }
    rows.push({
      name: rowNameOf(impl),
      token: meta.token as object,
      instance: instance as Lifecycle & object,
    });
  }

  // 一·五、预检：所有必需注入必须都有提供者。放在任何 onInit 之前——失败时不留半个应用。
  for (const instance of [...instances.values(), ...[...multi.values()].flat()]) {
    assertResolvable(instance, instances);
  }

  // 二、按**依赖序**逐行装配：填充注入 → onInit → 绑定契约面。
  //
  // 顺序由 `inject` 声明决定，不由清单写法决定：提供者必须排在消费者之前。清单顺序只作为
  // 同层次序的稳定基准（拓扑排序保持它）。环依赖不报错（保持原序），因为有些上游服务是
  // "按名字读"、框架看不到它的依赖边。
  //
  // 必须是逐行而不是「全填完再挂」：适配行的契约面在它自己的 onInit（`mount`）之后才拿到，
  // 后面的行在前面的行 onInit 之后注入，才拿得到上游面而不是空壳。
  const fibers: Array<{ dispose(): Promise<void> }> = [];
  try {
    for (const row of orderByDependencies(rows)) {
      const { instance } = row;
      const state: { name: string; state: "started" | "failed"; reason?: string } = {
        name: row.name,
        state: "started",
      };
      rowState.push(state);
      // 类型桥：cordis 的 ctx 运行时就有 `logger` / 事件面，缺的只是模块增强的类型。
      fillInjections(instance, instances, multi, ctx as unknown as Context);
      // 每一行都包一个 fiber：即使没有 `onInit`，`onDispose` 也要由 cordis 的卸载顺序管。
      const fiber = ctx.plugin({
        name: row.name,
        apply: async (child: CordisContext) => {
          await instance.onInit?.(child as unknown as Context);
          return typeof instance.onDispose === "function"
            ? () => instance.onDispose?.()
            : undefined;
        },
      });
      try {
        await fiber;
      } catch (error) {
        if (error instanceof Error) state.reason = error.message;
        throw error;
      }
      fibers.push(fiber);
      bindFace(ctx, row, instances);
      // 这一行可能在 mount 里按名字发布了服务（`ctx.reflect.provide`）：立刻采纳，
      // 后面几行的注入才拿得到。
      adoptNamedServices(ctx, instances);
    }
  } catch (error) {
    const failed = rowState.at(-1);
    if (failed !== undefined) failed.state = "failed";
    snapshot = {
      rows: rowState,
      names: [...instances.keys()].map(nameOf),
      tokens: [...instances.keys()].map(tokenNameOf),
    };
    for (const fiber of fibers.reverse()) await fiber.dispose();
    throw error;
  }
  // 上游行按名字发布的服务（没有对应行、只有令牌的，如 `sidebarRightTabs`）在这里补进令牌表。
  adoptNamedServices(ctx, instances);
  snapshot = {
    rows: rowState,
    names: [...instances.keys()].map(nameOf),
    tokens: [...instances.keys()].map(tokenNameOf),
  };

  return {
    ctx,
    get<T>(token: TokenClass<T>): T {
      // 按**令牌的元数据**查：契约与实现类指向同一个 `meta.token`（显式 `InjectionToken` 时是那个
      // 令牌对象，不是契约类本身）。
      const found = instances.get(tokenMetaOf(token as unknown as object).token);
      if (found === undefined) {
        throw new Error(`没有提供者：${tokenMetaOf(token).name}（装配清单里没有它）`);
      }
      return found as T;
    },
    tryGet<T>(token: TokenClass<T>): T | undefined {
      return instances.get(tokenMetaOf(token as unknown as object).token) as T | undefined;
    },
    getAll<T>(token: TokenClass<T>): T[] {
      return (multi.get(tokenMetaOf(token as unknown as object).token) ?? []) as T[];
    },
    async dispose(): Promise<void> {
      // 逆序卸载：cordis 按 fiber 的相反顺序收尾，onDispose 在依赖仍可读时执行。
      for (const fiber of [...fibers].reverse()) await fiber.dispose();
      await ctx.fiber.dispose();
    },
  };
}

/**
 * 单行装配：实例化一个 Provider、按它的字段注入从 ctx 取依赖、挂 `onInit`。
 *
 * `toCordis` 的插件对象用它；`bootstrapApplication` 的多行装配走自己的清单流程。
 * @param ctx - 行 ctx（cordis 子 ctx）。
 * @param provider - Provider 类。
 * @param config - 行配置（经 `Config` 规范化后交给构造函数）。
 * @returns 实例与卸载函数。
 */
export async function mountRow(
  ctx: Context,
  provider: Newable<unknown>,
  config?: unknown,
): Promise<{ readonly instance: unknown; dispose(): Promise<void> }> {
  const normalizer = (provider as { Config?: (input?: unknown) => unknown }).Config;
  const normalized = typeof normalizer === "function" ? normalizer(config) : config;
  const ctor = provider as unknown as new (config?: unknown) => unknown;
  const instance = normalized === undefined ? new ctor() : new ctor(normalized);
  const read = (name: string): unknown =>
    (ctx as unknown as { get(name: string): unknown }).get(name);
  if (typeof instance === "object" && instance !== null) {
    for (const key of Object.keys(instance)) {
      const placeholder = injectPlaceholderOf((instance as Record<string, unknown>)[key]);
      if (placeholder === undefined) continue;
      const meta = tokenMetaOf(placeholder.token);
      const resolved = read(meta.name);
      if (resolved === undefined && placeholder.mode === "one") {
        throw new Error(`没有提供者：${meta.name}（${instance.constructor.name} 需要它）`);
      }
      (instance as Record<string, unknown>)[key] = resolved;
    }
  }
  const lifecycle = instance as Lifecycle;
  const fiber = ctx.plugin({
    name: rowNameOf(provider),
    apply: async (child: CordisContext) => {
      await lifecycle.onInit?.(child as unknown as Context);
      return typeof lifecycle.onDispose === "function" ? () => lifecycle.onDispose?.() : undefined;
    },
  });
  try {
    await fiber;
  } catch (error) {
    await (fiber as unknown as { dispose(): Promise<void> }).dispose();
    throw error;
  }
  return {
    instance,
    dispose: async () => await (fiber as unknown as { dispose(): Promise<void> }).dispose(),
  };
}

/**
 * 按 `inject` 声明做拓扑排序：提供者排在消费者之前，同层次序沿用清单顺序。
 *
 * 只看"清单内互相注入"的边；上游按名字读服务的依赖框架看不到，只能靠清单顺序或 `rowConfig` 的显式声明。
 * @param rows - 清单里的行（原序）。
 * @returns 排好序的行。
 */
function orderByDependencies<Row extends { readonly token: object; readonly instance: object }>(
  rows: readonly Row[],
): Row[] {
  const byToken = new Map<object, Row>();
  for (const row of rows) byToken.set(row.token, row);
  const ordered: Row[] = [];
  const state = new Map<Row, "visiting" | "done">();

  const visit = (row: Row): void => {
    const current = state.get(row);
    if (current === "done") return;
    // 环：保持原序（不报错），由运行期暴露。
    if (current === "visiting") return;
    state.set(row, "visiting");
    for (const token of requiredTokensOf(row.instance)) {
      const provider = byToken.get(token);
      if (provider !== undefined && provider !== row) visit(provider);
    }
    state.set(row, "done");
    ordered.push(row);
  };

  for (const row of rows) visit(row);
  return ordered;
}

/**
 * 一个实例上要**按依赖序等**的令牌（必需 + 可选）。
 *
 * `optional` 也进这张表：它的语义是"可能**没有提供者**"，不是"可以不按依赖序"。
 * 漏掉它的代价是消费者排到适配行之前、拿到适配行的**空壳**——上游面在 `mount` 之后才绑上，
 * 于是运行期 `xxx.list is not a function`（真机上 `skill.list` 就这么炸过）。
 * 没有提供者时不产生依赖边（`byToken` 里找不到），所以"可以没有"这条语义不受影响。
 * @param instance - Provider 实例。
 * @returns 令牌列表。
 */
function requiredTokensOf(instance: object): object[] {
  const tokens: object[] = [];
  for (const key of Object.keys(instance)) {
    const placeholder = injectPlaceholderOf((instance as Record<string, unknown>)[key]);
    // `all`（多值）不进这里：它对应多行，\`byToken\` 是单值表，排序另有语义。
    if (placeholder === undefined || placeholder.mode === "all") continue;
    tokens.push(placeholder.token);
  }
  return tokens;
}

/**
 * 适配行的契约面在它 onInit 之后才拿到：把契约值换成上游发布的服务。
 * @param ctx - 根 ctx。
 * @param row - 刚挂完的那一行。
 * @param instances - 令牌值表。
 */
function bindFace(
  ctx: CordisContext,
  row: { readonly name: string; readonly token: object; readonly instance: Lifecycle & object },
  instances: Map<object, unknown>,
): void {
  const markers = row.instance as Record<symbol, unknown>;
  // 适配行忘了 `mount`：契约面一直是空壳，报错会漂到消费方（`undefined is not a function`）。
  // 与"上游本来就不发布服务"（副作用插件）区分开：后者 mount 过，只是 `kFace` 为空。
  if (markers[kAdapted] === true && markers[kMounted] !== true) {
    throw new Error(
      `适配行 ${row.name} 没有 mount 上游插件：契约面为空。` +
        "`onInit(ctx)` 里要 `await this.mount(ctx, config, deps)`",
    );
  }
  const face = markers[kFace];
  if (face === undefined) return;
  // 只更新令牌表，**不**按契约名补注册：上游已经用它自己的名字发布过这个服务，
  // 同一个实例挂两个名字会让按名字枚举的消费方（typert gateway）看到"不一致的绑定"。
  instances.set(row.token, face);
}

/**
 * 上游按名字发布的服务，若有同名令牌就补进令牌表。
 *
 * 有些能力没有对应的行（上游行在自己的 `apply` 里 `ctx.reflect.provide(name, …)`），
 * 消费侧却按令牌注入。这里扫一遍 cordis store，把「名字 → 令牌」对上。
 * @param ctx - 根 ctx。
 * @param instances - 令牌值表。
 */
function adoptNamedServices(ctx: CordisContext, instances: Map<object, unknown>): void {
  const store = (
    ctx.reflect as unknown as { store?: Record<symbol, { name?: string; value?: unknown }> }
  ).store;
  if (store === undefined) return;
  // `ReflectService.store` 是 symbol-keyed：`Object.values` 只枚举字符串键，永远拿不到东西。
  const entries = Reflect.ownKeys(store).map(
    (key) => (store as Record<PropertyKey, { name?: string; value?: unknown }>)[key],
  );
  for (const impl of entries) {
    if (impl === undefined || typeof impl.name !== "string") continue;
    const token = tokenNamed(impl.name);
    if (token !== undefined && !instances.has(token)) instances.set(token, impl.value);
  }
}

/**
 * 装配清单只收 DSL 形态：Provider 类、`{ provide }` 条目、`toCordis()` 的插件对象。
 *
 * 裸 cordis 插件（`{ name, apply }`）必须先用 `fromCordis()` 包成 Provider——否则它的
 * 依赖、生命周期、契约面都不在我们的类型与静态检查范围内，等于绕过 DSL 自己拼装配。
 * @param entry - 清单条目。
 */
function assertDslEntry(entry: ProviderEntry): void {
  if (typeof entry === "function") return;
  if (entry !== null && typeof entry === "object") {
    if (providerOfPlugin(entry) !== undefined) return;
    if ("provide" in entry) return;
    const name = (entry as { name?: unknown }).name;
    throw new Error(
      `装配清单里出现了未转换的 cordis 插件${typeof name === "string" ? `（"${name}"）` : ""}：` +
        "上游插件用 fromCordis() 包成 Provider，行入口用 toCordis()",
    );
  }
  throw new Error(`装配清单里有无法识别的条目：${String(entry)}`);
}

/**
 * 令牌对应的 cordis 服务名。
 * @param token - 契约。
 * @returns 服务名。
 */
function nameOf(token: object): string {
  return tokenMetaOf(token).name;
}

/**
 * 令牌的类名（诊断里给人看的那份）。
 * @param token - 契约。
 * @returns 类名或 `InjectionToken` 的名字。
 */
function tokenNameOf(token: object): string {
  const named = (token as { name?: string }).name;
  return named === undefined || named === "" ? tokenMetaOf(token).name : named;
}

/**
 * 实例化一个条目。
 * @param entry - 清单条目。
 * @param impl - 条目背后的 Provider 类（值 / 工厂条目用不到）。
 * @returns 实例。
 */
function instantiate(entry: ProviderEntry, impl: Newable<unknown>): unknown {
  if (typeof entry === "object" && entry !== null && "useValue" in entry) return entry.useValue;
  if (typeof entry === "object" && entry !== null && "useFactory" in entry)
    return entry.useFactory(undefined);
  const ctor = impl as unknown as new (config?: unknown) => unknown;
  const normalizer = (impl as { Config?: (input?: unknown) => unknown }).Config;
  const raw = configOf(entry);
  const normalized = typeof normalizer === "function" ? normalizer(raw ?? {}) : raw;
  return normalized === undefined ? new ctor() : new ctor(normalized);
}

/**
 * 把一个实例上的注入占位换成真实服务。
 * @param instance - 实例。
 * @param instances - 单值服务表。
 * @param multi - 多值服务表。
 */
/**
 * 只校验：每个必需注入都能在这个清单里找到提供者（不改任何值）。
 * @param instance - 实例。
 * @param instances - 单值服务表。
 * @param multi - 多值服务表。
 */
function assertResolvable(instance: unknown, instances: ReadonlyMap<object, unknown>): void {
  if (typeof instance !== "object" || instance === null) return;
  for (const key of Object.keys(instance)) {
    const placeholder = injectPlaceholderOf((instance as Record<string, unknown>)[key]);
    if (placeholder === undefined) continue;
    const meta = tokenMetaOf(placeholder.token);
    assertShape(meta, placeholder.mode, instance);
    // 值令牌可能由上游在 mount 期按名字发布：预检放行，留给该行激活时的填充检查。
    if (isValueToken(meta.token)) continue;
    if (placeholder.mode === "one" && !instances.has(meta.token)) {
      throw new Error(`没有提供者：${meta.name}（${instance.constructor.name} 需要它）`);
    }
  }
}

/**
 * 注入形态校验：multi 令牌只能用 `inject.all`，单值令牌不能用 `inject.all`。
 * @param meta - 令牌元数据。
 * @param mode - 注入形态。
 * @param instance - 用错的实例（用于报错定位）。
 */
function assertShape(meta: ReturnType<typeof tokenMetaOf>, mode: string, instance: object): void {
  const isMulti = meta.multi;
  if ((mode === "all") !== isMulti) {
    throw new Error(
      `注入形态不对：${meta.name} 是${isMulti ? "" : "非"} multi 令牌，` +
        `${instance.constructor.name} 用了 ${mode === "all" ? "inject.all" : "inject"}；` +
        `multi 令牌用 inject.all，单值令牌用 inject`,
    );
  }
}

/**
 * 把实例上的注入占位换成真实服务。
 * @param instance - 实例。
 * @param instances - 单值服务表。
 * @param multi - 多值服务表。
 */
function fillInjections(
  instance: unknown,
  instances: ReadonlyMap<object, unknown>,
  multi: ReadonlyMap<object, unknown[]>,
  ctx: Context,
): void {
  if (typeof instance !== "object" || instance === null) return;
  for (const key of Object.keys(instance)) {
    const placeholder = injectPlaceholderOf((instance as Record<string, unknown>)[key]);
    if (placeholder === undefined) continue;
    const meta = tokenMetaOf(placeholder.token);
    assertShape(meta, placeholder.mode, instance);
    const resolved =
      placeholder.mode === "all" ? (multi.get(meta.token) ?? []) : instances.get(meta.token);
    if (resolved === undefined && placeholder.mode === "one") {
      throw new Error(`没有提供者：${meta.name}（${instance.constructor.name} 需要它）`);
    }
    (instance as Record<string, unknown>)[key] = resolved;
  }
  // 事件作为**字段**时也要拿到本行 ctx：`@Injectable()` 的类上写
  // `readonly flush$ = new SessionFlush()`，`onInit` 不会自己跑——在这里统一绑定。
  for (const key of Object.keys(instance)) {
    const value = (instance as Record<string, unknown>)[key];
    if (value instanceof EventEmitter) value.onInit(ctx);
  }
}
