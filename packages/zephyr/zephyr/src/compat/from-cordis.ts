// `fromCordis`：把上游 cordis 插件包成 Provider（只做类型面桥接）。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import type { Awaitable, Context, TokenClass } from "../injection.ts";
import {
  hasTokenMeta,
  Injectable,
  InjectionToken,
  kAdapted,
  kFace,
  kMounted,
  tokenMetaOf,
} from "../token.ts";

/**
 * 给上游一个 ctx 代理：deps 里的名字在**读取时**替换，其余原样转发。
 *
 * - `ctx.get(name)` / `ctx.<name>` / `name in ctx` 先看 deps；
 * - `ctx.inject(names, cb)` 只要 deps 覆盖了声明就立即回调，否则原样转发给 cordis；
 * - 其它成员（`provide` / `plugin` / `effect` / `root` …）绑定到原 ctx 上。
 * @param ctx - 行 ctx。
 * @param deps - 上游声明的依赖（名字 → 值）。
 * @returns 读面被替换的 ctx。
 */
function withDeps(
  ctx: CordisContext,
  deps: Record<string, unknown> | undefined,
  onProvide: (name: string, value: unknown) => void,
  onPlugin?: (fiber: PromiseLike<unknown>) => void,
): CordisContext {
  // 即使没有 deps 也要建代理：`provide` 的拦截是取契约面的唯一来源。
  return buildProxy();

  /** 读面按 deps 替换；`provide` 顺手把上游发布的名字记下来。 */
  function buildProxy(): CordisContext {
    const read = (name: string, fallback?: unknown): unknown =>
      Object.hasOwn(deps ?? {}, name)
        ? (deps ?? {})[name]
        : (ctx as unknown as { get(name: string, f?: unknown): unknown }).get(name, fallback);
    const inject = (names: readonly string[], callback?: (scoped: unknown) => unknown): unknown => {
      if (names.every((name) => Object.hasOwn(deps ?? {}, name))) {
        // 回调必须拿到**真子 ctx**，不能直接给本代理：上游按 `scopeOf(ctx)` 分层
        // （`ScopedLayers` 读 ctx 上的 `kScope` 标记），行代理没有那个标记，注册会掉进 global 层
        // ——`context:file-reference` 这类 per-agent 段落于是第二个 agent 就撞名。
        // `isolate()` 派生一个新 ctx（继承 `kScope`），只给一个不存在的服务名换 key，不影响别的解析。
        const scoped = (ctx as unknown as { isolate(name: string): CordisContext }).isolate(
          "_zephyr_deps",
        );
        const result = callback?.(withDeps(scoped, deps, onProvide));
        return Object.assign(Promise.resolve(result), { dispose: () => {} });
      }
      // 转发给 cordis 时也要包一层：回调拿到的 ctx 同样要能读 deps
      // （上游常见 `ctx.inject(['x'], (scoped) => …在回调里读别的服务)`）。
      return (ctx as unknown as { inject(names: readonly string[], cb?: unknown): unknown }).inject(
        names,
        callback === undefined
          ? undefined
          : (scoped: CordisContext) => callback(withDeps(scoped, deps, onProvide)),
      );
    };
    /** 上游既可能 `ctx.provide`，也可能 `ctx.reflect.provide`：两条路都要记到。 */
    const provide = (name: string, value: unknown): unknown => {
      onProvide(name, value);
      return (ctx as unknown as { provide(name: string, value: unknown): unknown }).provide(
        name,
        value,
      );
    };
    const reflect = (ctx as unknown as { reflect: object }).reflect;
    const reflectShell = new Proxy(reflect, {
      get: (target, property) => {
        if (property === "provide") return provide;
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function"
          ? (value as (...args: never[]) => unknown).bind(target)
          : value;
      },
    });
    const proxy = new Proxy(ctx, {
      get: (target, property) => {
        if (property === "get") return read;
        if (property === "inject") return inject;
        if (property === "provide") return provide;
        if (property === "reflect") return reflectShell;
        if (property === "plugin") {
          // 上游用 `ctx.plugin(...)` 拿 fiber、再从 `fiber.ctx` 往下建 scope（`createScope` 就是这样）：
          // 那条链绕开了本代理，所以 `fiber.ctx` 也要包一层。
          return (plugin: unknown, config?: unknown): unknown => {
            const fiber = (
              ctx as unknown as { plugin(plugin: unknown, config?: unknown): object }
            ).plugin(plugin, config);
            // 上游会把服务放在子插件里（`ctx.plugin(ServiceClass)` 才 `provide`）：收集起来等它们落定。
            onPlugin?.(fiber as PromiseLike<unknown>);
            return new Proxy(fiber, {
              get: (target, prop) => {
                if (prop === "ctx") {
                  return withDeps((target as { ctx: CordisContext }).ctx, deps, onProvide);
                }
                const value = Reflect.get(target, prop, target) as unknown;
                // `fiber` 是 thenable：`then` 要绑回去，`await fiber` 才成立。
                return typeof value === "function"
                  ? (value as (...args: never[]) => unknown).bind(target)
                  : value;
              },
            });
          };
        }
        if (property === "extend") {
          // 上游会拿 `ctx.extend(...)` 建子 ctx（`agent.ctx` 这类）：子 ctx 也要带 deps 替换，
          // 否则它在严格读时会撞 cordis 的 inject 声明检查。
          return (meta?: unknown): unknown =>
            withDeps(
              (ctx as unknown as { extend(meta?: unknown): CordisContext }).extend(meta),
              deps,
              onProvide,
            );
        }
        if (typeof property === "string" && Object.hasOwn(deps ?? {}, property))
          return (deps ?? {})[property];
        const value = Reflect.get(target, property, target) as unknown;
        // 方法绑定到原 ctx：调用方（上游插件）拿到的是真 ctx 的成员。
        return typeof value === "function"
          ? (value as (...args: never[]) => unknown).bind(target)
          : value;
      },
      has: (target, property) =>
        (typeof property === "string" && Object.hasOwn(deps ?? {}, property)) ||
        Reflect.has(target, property),
    }) as CordisContext;
    return proxy;
  }
}

/**
 * 深合并配置：对象逐键，数组与标量整体替换。
 * @param base - 默认配置。
 * @param patch - 行配置。
 * @returns 合并结果；两层都没有时给 `undefined`。
 */
function mergeConfig(base: unknown, patch: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(base) && !isPlainObject(patch)) return undefined;
  const merged: Record<string, unknown> = { ...(isPlainObject(base) ? base : {}) };
  for (const [key, value] of Object.entries(isPlainObject(patch) ? patch : {})) {
    const previous = merged[key];
    merged[key] =
      isPlainObject(previous) && isPlainObject(value) ? mergeConfig(previous, value) : value;
  }
  return merged;
}

/**
 * 是否是普通对象（数组与类实例都不算）。
 * @param value - 待判断的值。
 * @returns 判断结果。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * 判断是不是 cordis `Service` 子类（要 `new`，不能当函数插件调用）。
 * @param upstream - 上游插件。
 * @returns 判断结果。
 */
function isServiceClass(
  upstream: unknown,
): upstream is new (ctx: CordisContext, config?: unknown) => object {
  // 鸭子类型：cordis 的 `Service` 子类都继承静态 `init` 符号。不用 `instanceof Service`——
  // 包入口与 `./src/service.ts` 在 vite 下是两个模块实例，`instanceof` 会假阴性。
  return typeof upstream === "function" && hasServiceInit(upstream);
}

/**
 * 这个构造面是不是 cordis `Service`（看静态 `init` 符号）。
 * @param ctor - 待判断的构造面。
 * @returns 判断结果。
 */
function hasServiceInit(ctor: unknown): ctor is { readonly init: symbol } {
  return typeof ctor === "function" && typeof (ctor as { init?: unknown }).init === "symbol";
}

/**
 * 按契约名（连字符或驼峰）从 cordis store 取面：上游把服务放在子插件里时，apply 期间拦不到。
 * @param ctx - 行 ctx。
 * @param contractName - 契约的连字符名。
 * @returns 契约面，或 `undefined`。
 */
function faceFromStore(ctx: Context, contractName: string): unknown {
  const camel = contractName.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
  const reflect = ctx.reflect as unknown as { get(name: string, strict?: boolean): unknown };
  for (const name of [contractName, camel]) {
    const found = reflect.get(name, false);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 从上游发布的服务里挑出契约面。
 *
 * 优先与契约名同名（连字符或驼峰），其次只有一个就取它，最后取第一个。
 * @param provided - 上游 `provide` 过的名字与值（按调用顺序）。
 * @param contractName - 契约的连字符名。
 * @returns 契约面，或 `undefined`。
 */
function pickFace(
  provided: readonly { name: string; value: unknown }[],
  contractName: string,
): unknown {
  const camel = contractName.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
  const exact = provided.find((entry) => entry.name === contractName || entry.name === camel);
  if (exact !== undefined) return exact.value;
  return provided.length === 1 ? provided[0]?.value : provided[0]?.value;
}

/**
 * 跑上游插件的 apply（函数插件或 `{ apply }` 对象插件）。
 * @param upstream - 上游插件。
 * @param ctx - 行 ctx。
 * @param config - 上游 config。
 * @returns apply 返回的 disposer（如果有）。
 */
async function callApply(upstream: unknown, ctx: CordisContext, config: unknown): Promise<unknown> {
  const callable =
    typeof upstream === "function" ? upstream : (upstream as { apply?: Function }).apply;
  if (typeof callable !== "function") {
    throw new Error(`fromCordis：上游插件没有 apply（收到 ${typeof upstream}）`);
  }
  return await callable.call(upstream, ctx, config);
}

/** 适配行的 `mount` 面。 */
export interface AdaptedRow {
  /**
   * 行配置（清单条目给的）。需要"改造配置"再 mount 的行读它。
   *
   * 名字不能用 `config`：很多上游实例把 `config` 声明成 private，实例类型里一交集就成 `never`。
   */
  readonly rowConfig?: unknown;

  readonly [kFace]?: unknown;

  /**
   * 装上游插件，并把它发布的服务作为契约面记下来。
   * @param ctx - 行 ctx。
   * @param config - 上游插件的 config。
   * @param deps - 上游 `inject` 声明要的依赖（名字 → 值）。
   */
  mount(ctx: Context, config?: unknown, deps?: Record<string, unknown>): Promise<void>;
}

/** 上游插件是类时取它的实例类型；函数 / 对象插件拿不到，给 `unknown`。 */
type UpstreamInstance<U> = U extends abstract new (...args: never[]) => infer I ? I : unknown;

/**
 * 适配行基类：`extends` 它拿到 `mount`，并带一个 `token` 静态成员。
 *
 * 实例类型里并了**上游实例类型**：宿主侧的行会注入实现类来拿上游才有的成员
 * （`inject(CommandRegistryDefault)` 后调 `list()`），类型上得给到，否则只剩 `as` 断言。
 */
export type AdaptedClass<K extends TokenClass<unknown> = TokenClass<unknown>, U = unknown> = (new (
  config?: unknown,
) => AdaptedRow &
  UpstreamInstance<U> & {
    onInit(ctx: Context): Awaitable<void>;
    onDispose(): Awaitable<void>;
  } & object) & {
  /** 这一行的令牌：有契约时是契约，无契约时是从上游插件名派生的令牌。 */
  readonly token: K;
};

/**
 * 把上游插件包成 Provider。三种形态：
 *
 * - `fromCordis(contract, upstream)`：契约 + 上游，契约面取上游发布的服务；
 * - `fromCordis(upstream)`：**无契约**，令牌从上游插件名派生（`Adapted.token`）；
 * - `fromCordis(contract)`：**纯实现**，没有上游可装，子类自己实现契约方法。
 * @param contractOrUpstream - 契约，或（无契约时）上游插件本身。
 * @param maybeUpstream - 上游插件（函数或 `{ apply }` 对象）。
 * @returns 可以 `extends` 的基类。
 */
export function fromCordis<K extends TokenClass<unknown>, U>(
  contract: K,
  upstream: U,
): AdaptedClass<K, U>;
// 单参：参数是契约时是纯实现行，是上游类时是无契约适配行。两者都要带上参数本身的实例类型，
// 否则 `inject(实现类)` 拿不到上游成员。
export function fromCordis<U extends object>(upstream: U): AdaptedClass<TokenClass<unknown>, U>;
export function fromCordis(
  contractOrUpstream: TokenClass<unknown> | object,
  maybeUpstream?: unknown,
): AdaptedClass {
  const withContract = maybeUpstream !== undefined || hasTokenMeta(contractOrUpstream);
  const contract = withContract ? (contractOrUpstream as TokenClass<unknown>) : undefined;
  const upstream =
    maybeUpstream !== undefined ? maybeUpstream : withContract ? undefined : contractOrUpstream;
  const token =
    contract ?? InjectionToken((upstream as { name?: string } | undefined)?.name ?? "upstream");
  const adapted = upstream !== undefined;

  abstract class Adapted implements AdaptedRow {
    /**
     * @param rowConfig - 行配置（由装配清单的条目给）。适配行不必自己存，`mount` 缺省就用它。
     */
    constructor(readonly rowConfig?: unknown) {}

    /**
     * 适配行的默认配置：与行配置**深合并**后再交给上游 `static Config` 规范化。
     * 子类写 `static readonly defaultConfig = { … }` 即可，不需要构造参数。
     */
    static readonly defaultConfig?: Record<string, unknown>;

    /** 适配行：它的契约值由上游插件发布，自己不做服务注册。纯实现行不是适配行。 */
    readonly [kAdapted] = adapted;

    /** 让子类可以 `override`：基类声明这两条生命周期（默认什么都不做）。 */
    onInit(_ctx: Context): Awaitable<void> {}

    onDispose(): Awaitable<void> {}

    [kFace]: unknown;

    /** `mount` 跑过就置位：装配期据此区分"忘了 mount"与"上游本来就不发布服务"。 */
    [kMounted] = false;

    async mount(
      ctx: Context,
      config: unknown = this.rowConfig,
      deps?: Record<string, unknown>,
    ): Promise<void> {
      this[kMounted] = true;
      if (!adapted) return;
      const cordis = ctx as unknown as CordisContext & {
        reflect: {
          provide(name: string, value: unknown): void;
          get(name: string, strict?: boolean): unknown;
        };
      };
      // 配置分三层：适配行的 `defaultConfig` → 行配置 → 上游 `static Config` 的 schema 默认值。
      // 前两层深合并，第三层由上游 schema 规范化时补齐；少任何一层，上游构造里都会读到 `undefined`。
      const defaults = (this.constructor as { defaultConfig?: Record<string, unknown> })
        .defaultConfig;
      const merged = mergeConfig(defaults, config ?? this.rowConfig);
      const normalizer = (upstream as { Config?: (input?: unknown) => unknown }).Config;
      const effective = typeof normalizer === "function" ? normalizer(merged ?? {}) : merged;
      // deps **不注册**：上游读依赖时按名字替换（`ctx.get` / `ctx.<service>` / `ctx.inject`）。
      // 注册进 cordis 会污染根、和上游自己的服务抢名字，还要绕过 fiber 的 ACTIVE 检查。
      // 上游是 cordis `Service` 子类：它必须被 `new`（`super(ctx, name)` 里注册自己），
      // 直接当函数调用会报 "Class constructor cannot be invoked without 'new'"。
      if (isServiceClass(upstream)) {
        // `Service` 子类的注册发生在构造里（`super(ctx, name)`），直接 new 比走 cordis 的
        // 插件调度更确定：后者把构造排到队列里，`mount` 返回时可能还没注册。
        // 构造里读依赖同样要走 deps 替换（否则 `static inject` 的访问检查直接抛）。
        // **注册落点用根 ctx**：`super(ctx, name)` 把 owner fiber 记成传进来的 ctx，兄弟行沿 fiber
        // 链到 root 才找得到；用行 ctx 构造的话，服务只在这一行的 fiber 上，别处读它就是
        // `cannot get property "x" without inject`（`remoteAccess` / `sessions` 这类跨行读法很常见）。
        const owner = (cordis as unknown as { root?: CordisContext }).root ?? cordis;
        const instance = new upstream(
          withDeps(owner, deps, () => {}),
          effective,
        );
        // 有的上游把注册放在 `[Service.init]()` 里（异步）：等它结束，`mount` 之后拿到的才是可用实例。
        const initSymbol = hasServiceInit(upstream) ? upstream.init : undefined;
        const init =
          initSymbol === undefined
            ? undefined
            : (instance as Record<symbol, (() => unknown) | undefined>)[initSymbol];
        if (typeof init === "function") await init.call(instance);
        this[kFace] = instance;
        (ctx as unknown as { effect(fn: () => unknown): void }).effect(() => () => {
          const disposable = instance as { dispose?: () => unknown };
          void disposable.dispose?.();
        });
        return;
      }
      // 上游发布的服务名与我们契约的连字符名几乎从不相同（`SessionStore` vs `sessions`）：
      // 记下它 provide 的名字，按名字取面，而不是拿契约名去 store 里猜。
      const provided: Array<{ name: string; value: unknown }> = [];
      const childFibers: Array<PromiseLike<unknown>> = [];
      const applied = await callApply(
        upstream,
        withDeps(
          cordis,
          deps,
          (name, value) => provided.push({ name, value }),
          (fiber) => childFibers.push(fiber),
        ),
        effective,
      );
      // 等上游自己的子插件加载完：它们的 `provide` 发生在 `apply` 返回之后。
      await Promise.all(childFibers.map((fiber) => Promise.resolve(fiber).catch(() => undefined)));
      if (typeof applied === "function") {
        (ctx as unknown as { effect(fn: () => unknown): void }).effect(applied as () => unknown);
      }
      const contractName = tokenMetaOf(token as unknown as object).name;
      this[kFace] =
        pickFace(provided, contractName) ??
        faceFromStore(cordis as unknown as Context, contractName);
    }
  }
  Injectable({ token: token as unknown as Function })(Adapted);
  (Adapted as unknown as { token: TokenClass<unknown> }).token = token;
  return Adapted as unknown as AdaptedClass;
}
