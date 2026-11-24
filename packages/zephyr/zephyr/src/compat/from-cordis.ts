// `fromCordis`：把上游 cordis 插件包成 Provider（只做类型面桥接）。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
// 只用 cordis 的 `symbols`（`Service` 的 tracker / `shadow` 等符号）：它们在 `src/utils.ts`，
// 包根没有转出来——包 `exports` 有 `./src/*`，所以按那个入口引。
import { symbols } from "@deepseek-ai/cordis/src/utils.ts";
import type { Awaitable, Context, TokenClass } from "@morlay/zephyr";
import {
  hasTokenMeta,
  Injectable,
  InjectionToken,
  kAdapted,
  kFace,
  kMounted,
  kRowOwner,
  rootContextKey,
  tokenMetaOf,
} from "@morlay/zephyr";

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
  /** `fiber` 的取值来源：ctx 可能被换成 root（属性读要在同一张 `props` 表上），fiber 必须仍是**行**的。 */
  fiberOf?: CordisContext,
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
      // 两个"已经齐了"的判据都当场执行回调，不排队：
      // - deps 里有（本仓清单给的替换值）；
      // - 服务已经注册在 cordis 的 store 里（上游常见 `ctx.inject(['x'], cb)` 等本行刚 `new` 的服务）。
      //
      // 为什么后者必须当场跑：上游 0.2.3 起 `connection` 的 `HostConnectionService` 就是在上游
      // `ctx.inject(['connection.authentication'])` 的回调里 `new` 的。交给 cordis 排队时它会在
      // `apply` 返回**之后**才执行，`mount` 就取不到那个服务，契约面（`Connection` 令牌）只能留空，
      // 消费方（gateway / 上传 / 交付物）于是拿不到宿主面的 `rpc` / `fetch`。
      const ready =
        names.every((name) => Object.hasOwn(deps ?? {}, name)) ||
        names.every(
          (name) =>
            Object.hasOwn(deps ?? {}, name) ||
            (ctx as unknown as { get(name: string, f?: unknown): unknown }).get(name, false) !==
              undefined,
        );
      if (ready) {
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
      const fiber = (
        ctx as unknown as { inject(names: readonly string[], cb?: unknown): unknown }
      ).inject(
        names,
        callback === undefined
          ? undefined
          : (scoped: CordisContext) => callback(withDeps(scoped, deps, onProvide)),
      );
      // `ctx.inject` 的回调也是子 fiber：上游 0.2.3 起把服务**建在回调里**（例如
      // `connection` 的 `HostConnectionService` 在建在 `inject(['connection.authentication'])` 里），
      // 不把它记进待等清单，`mount` 返回时那个服务还没注册，契约面就会绑到先注册的另一个服务上。
      if (fiber !== undefined && typeof (fiber as { then?: unknown }).then === "function") {
        onPlugin?.(fiber as PromiseLike<unknown>);
      }
      return fiber;
    };
    /**
     * 上游既可能 `ctx.provide`，也可能 `ctx.reflect.provide`：两条路都要记到。
     *
     * **必须走 `reflect.provide`**：它除了把值放进 store，还会在 `reflect.props` 里登记这个名字——
     * cordis 的**属性读**（`ctx.a` 与子服务 `ctx.a.b`）走的就是 `props` 那张表。直接 `ctx.provide`
     * 只写 store，读出来就是 `cannot get property "a.b" without inject`（`uiSession.sessionStatus`
     * 就是这样挂的）。
     */
    const provide = (name: string, value: unknown, check?: unknown): unknown => {
      onProvide(name, value);
      const target = ctx as unknown as {
        reflect: { provide(name: string, value: unknown, check?: unknown): unknown };
      };
      // **check 要透传**：`Service` 构造里是 `reflect.provide(name, self, this[Service.check])`，
      // 丢掉它会让 cordis 把该名字判成"不可用"，属性读（`ctx.a` / `ctx.a.b`）直接抛
      // `cannot get property "…" without inject`。
      return target.reflect.provide(name, value, check);
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
        // 无条件探针（`ZEPHYR_DEBUG_PROXY=1`）：确认上游那次 `Reflect.get(ctx, "a.b")` 到底有没有
        // 经过本代理。带点的名字与 `uiSession*` 全打，其余跳过（日志量太大）。
        if (process.env["ZEPHYR_DEBUG_PROXY"] === "1") {
          const key =
            typeof property === "symbol"
              ? (Symbol.keyFor(property) ?? property.toString())
              : property;
          if (typeof key === "string" && (key.includes("uiSession") || key.includes("."))) {
            console.error(
              "[proxy] get %s | depsHit=%s | depsKeys=%s",
              key,
              Object.hasOwn(deps ?? {}, key),
              Object.keys(deps ?? {}).join(","),
            );
          }
        }
        if (property === "fiber" && fiberOf !== undefined) {
          return (fiberOf as unknown as { fiber: unknown }).fiber;
        }
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
        if (typeof property === "string" && Object.hasOwn(deps ?? {}, property)) {
          // **原样返回**：不包 `getTraceable`。上游服务实例里有 `#private` 字段，包成 Proxy 之后
          // 访问那些字段会抛 `Private element is not present on this object`（真机上表现为
          // "新建会话失败 / skill 根目录 skipped"）。子服务的读由下面的按名兜底负责。
          return (deps ?? {})[property];
        }
        // 上游 0.2.3 的子服务（注册名带点，`a.b`）在属性读时会被 cordis 翻译成
        // `Reflect.get(ctx, "a.b")`——它要求该名字在**这个 ctx** 的可见面里。deps 没交时按名字
        // 宽松读一次（`ctx.get(name, false)` 与 `ctx.a.b` 的 store 是同一个），读不到再走原分支。
        if (typeof property === "string" && property.includes(".")) {
          const byName = read(property) as unknown;
          if (byName !== undefined) return byName;
        }
        // 上游 0.2.3 的子服务（`a.b`，注册名带点）是**全局**的（root store 的同一个 symbol），
        // 但 cordis 的属性读要求该名字在本 ctx 的可见面里，否则抛 `cannot get property "a.b" without inject`。
        // 上游服务实例自己的 ctx 常常是本行的 deps 代理（例如 `uiSession` 由 `SessionLayout` 建），
        // 于是实例上读子服务会经这里回落成真 ctx 的严格读。所以：属性读失败时按**名字**再宽松读一次
        // （`read` 就是 `ctx.get(name, false)` 的口径），读不到再把原错抛出去。
        let value: unknown;
        try {
          value = Reflect.get(target, property, target) as unknown;
          if (process.env["ZEPHYR_DEBUG_TRACE"] === "1" && property === "uiSession") {
            const tracked = value as Record<symbol, { ctx?: unknown }> | undefined;
            console.error(
              "[dbg] 读 uiSession（回落真 ctx）| 值的 tracker.ctx === 代理 =",
              tracked?.[symbols.tracker]?.ctx === proxy,
            );
          }
        } catch (error) {
          if (typeof property !== "string") throw error;
          const fallback = read(property);
          if (fallback === undefined) throw error;
          return fallback;
        }
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
 * 装这一行的那个 ctx（装配器写在行 ctx 的 `kRowOwner` 上）；直接 `mount(ctx)` 时回落 `ctx.root`。
 * @param ctx - 行 ctx。
 * @returns owner ctx。
 */
function rowOwnerOf(ctx: CordisContext): CordisContext {
  return (
    (ctx as unknown as { [kRowOwner]?: CordisContext })[kRowOwner] ??
    ((ctx as unknown as Context)[rootContextKey] as CordisContext | undefined) ??
    ctx
  );
}

/**
 * per-agent 行的 deps：把「服务实例」换成**装这一行的那一层**的代理。
 *
 * 上游插件用 `ctx.tools.register(...)` / `ctx.tools.setExecutor(...)` 时，作用域取自**服务实例自己的
 * ctx**；直接把它传进去，注册就落在应用根，第二个 agent 再装同一个工具名就撞
 * （`tool "skill" is already registered (for a per-agent variant, register through that agent's
 * `agent.ctx` instead)`）。所以按 agent 装配的行，deps 里凡是这一层 store 里存在的服务，都用
 * 换成**这一层 store 里注册的实例**——上游拿到的就是「这个 agent 的服务面」。
 *
 * **不包 `getTraceable`**：包出来的是 Proxy，而上游服务里有 `#private` 字段，在 Proxy 上访问会抛
 * `Private element is not present on this object`（真机症状：skill 根目录 skipped、新建会话失败）。
 * @param owner - 装这一行的 ctx。
 * @param deps - 上游声明的依赖（名字 → 值）。
 * @returns 按 owner 收口后的 deps。
 */
function scopedDeps(
  owner: CordisContext,
  deps: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (deps === undefined) return undefined;
  // 根 ctx 走符号键（上游 cordis 0.2.3 删了 `ctx.root` 属性，读它会抛 "cannot get property \"root\" without inject"）。
  const root =
    ((owner as unknown as Context)[rootContextKey] as CordisContext | undefined) ?? owner;
  // 应用根的行不需要这一层：那份实例的作用域本来就是根。
  if (owner === root) return deps;
  // `reflect` 是 cordis 的**模块增强**挂上去的（`vendor/…/cordis/src/events.ts` 里
  // `interface Context { reflect }`）；我们的 `tsc` program 不加载那份增强，所以这里按单层断言读——
  // 运行期它就在 `ctx` 上（`ctx.get` / `ctx.provide` 的底座）。
  const reflect = (owner as { reflect?: { get(name: string, strict?: boolean): unknown } }).reflect;
  if (reflect === undefined) return deps;
  const traced: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(deps)) {
    const service = reflect.get(name, false);
    // **原样给，不包 `getTraceable`**：包出来的是 Proxy，而上游服务里有 `#private` 字段——在 Proxy 上
    // 访问它们抛 `Private element is not present on this object`（真机症状：skill 根目录 skipped、
    // 新建会话失败）。作用域收口改为换成**这一层 store 里注册的那个实例**。
    traced[name] = service !== undefined ? service : value;
  }
  return traced;
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
  // 走 `ctx.get`（cordis 的**全局 store**）而不是 `ctx.reflect.get`（沿 fiber 链找）：上游 0.2.3 起
  // 有些服务在 `ctx.inject` 回调的子 fiber 上注册（例如 `connection`），沿链从行 ctx 找不到它。
  for (const name of [contractName, camel]) {
    const found = ctx.get(name, false);
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
  // 派生服务不算契约面：`connection.authentication` 是 `connection` 的派生服务（上游 0.2.3 在
  // 契约服务之前先注册它），盲取第一个会把契约绑到错误的对象上。过滤后没有候选就交回调用方
  // ——装配末尾的 `adoptNamedServices` 会按名字把真服务补进令牌表。
  const unrelated = provided.filter(
    (entry) => !entry.name.startsWith(`${contractName}.`) && !entry.name.startsWith(`${camel}.`),
  );
  return unrelated.length === 1 ? unrelated[0]?.value : undefined;
}

/**
 * 上游 `inject` 声明里的每个名字，要么在 deps 里（本行显式交），要么已在 store 里（装配顺序保证）。
 *
 * 都不满足时上游会在运行期按名字严格读时抛 `cannot get property "x" without inject`，症状是浏览器白屏；
 * 这里把它变成装配期的一条明确失败，连同行名与缺的名字一起报出来。
 * @param upstream - 上游插件（函数插件或 `Service` 子类）。
 * @param ctx - 装这一行的 ctx。
 * @param deps - 本行交给上游的依赖表。
 */
function assertInjectedDepsSatisfied(
  upstream: unknown,
  ctx: CordisContext,
  deps: Record<string, unknown> | undefined,
): void {
  const declared = (upstream as { inject?: readonly string[] }).inject;
  if (declared === undefined || declared.length === 0) return;
  const store = ctx as unknown as { get(name: string, strict?: boolean): unknown };
  const missing = declared.filter(
    (name) => !Object.hasOwn(deps ?? {}, name) && store.get(name, false) === undefined,
  );
  if (missing.length === 0) return;
  const row = (ctx as unknown as { fiber?: { name?: string } }).fiber?.name ?? "?";
  throw new Error(
    `fromCordis：${row} 的上游 inject 声明里有既没交 deps、也不在 store 里的依赖：${missing.join(", ")}`,
  );
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
  mount(ctx: Context, config?: unknown, deps?: Record<string, unknown>): Promise<unknown>;
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
    /**
     * `mount` 的返回值就是上游实例：基类实现按 `unknown` 返回（它没有上游类型参数），
     * 精度在这里补——适配行的具体类型带上 `U` 之后，调用点不必再 `as`。
     */
    mount(
      ctx: Context,
      config?: unknown,
      deps?: Record<string, unknown>,
    ): Promise<UpstreamInstance<U>>;
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

  // 适配行**继承契约**（`extends` 是唯一写法）：令牌与名字都从继承的元数据来，不再手工指定。
  // `InjectionToken` 造出来的也是类，所以两条来源（契约类 / 纯令牌）走同一条路。
  const ContractBase = token as unknown as abstract new () => object;

  abstract class Adapted extends ContractBase implements AdaptedRow {
    /**
     * @param rowConfig - 行配置（由装配清单的条目给）。适配行不必自己存，`mount` 缺省就用它。
     */
    constructor(readonly rowConfig?: unknown) {
      super();
    }

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
    ): Promise<unknown> {
      this[kMounted] = true;
      if (!adapted) return this[kFace];
      /** 本次 mount 交给上游的那层 deps 代理（探针用：比对上游实例的 `tracker.ctx` 是不是它）。 */
      let usedDeps: CordisContext | undefined;
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
      // **上游 `inject` 声明是装配契约**：声明了却既没交 deps、也不在 store 里的名字，上游会在运行期
      // 按名字严格读时抛 `cannot get property "x" without inject`（症状是浏览器白屏，离装配点很远）。
      // 这里装配期就 fail loud，把缺的名字连同行名一起报出来。
      assertInjectedDepsSatisfied(upstream, ctx, deps);
      // **应用根的行建在 root ctx 上**：cordis 的 `reflect.props` 是**每个 ctx 一张表**，属性读
      // （`ctx.a` 与子服务 `ctx.a.b`）按"定义处 ctx"查那张表。行 ctx 各自一张时，A 行注册的名字
      // B 行按属性读不到（`uiSession.sessionStatus` 就是这样挂的），store 里明明有。
      // `@AgentScoped()` 的行仍用行 ctx（注册落点必须留在 agentCtx）。
      const rootCtx = (ctx as unknown as Record<symbol, unknown>)[rootContextKey] as
        | CordisContext
        | undefined;
      const ownerForCtx = rowOwnerOf(cordis);
      const upstreamCtx = rootCtx !== undefined && ownerForCtx === rootCtx ? rootCtx : cordis;
      // deps **不注册**：上游读依赖时按名字替换（`ctx.get` / `ctx.<service>` / `ctx.inject`）。
      // 注册进 cordis 会污染根、和上游自己的服务抢名字，还要绕过 fiber 的 ACTIVE 检查。
      // 上游是 cordis `Service` 子类：它必须被 `new`（`super(ctx, name)` 里注册自己），
      // 直接当函数调用会报 "Class constructor cannot be invoked without 'new'"。
      if (isServiceClass(upstream)) {
        // `Service` 子类的注册发生在构造里（`super(ctx, name)`），直接 new 比走 cordis 的
        // 插件调度更确定：后者把构造排到队列里，`mount` 返回时可能还没注册。
        // 构造里读依赖同样要走 deps 替换（否则 `static inject` 的访问检查直接抛）。
        // **注册落点用「装这一行的那个 ctx」（`kRowOwner`）**：`super(ctx, name)` 把 owner fiber 记成
        // 传进来的 ctx，兄弟行要沿 fiber 链找到它。装配器装到哪一层，服务就属于哪一层——应用根的行
        // 用根（跨行读得到，`remoteAccess` / `sessions` 这类读法很常见）；`@AgentScoped()` 的行用
        // 该 agent 的 `agentCtx`（同 agent 的兄弟行读得到，别的 agent 与根读不到）。直接
        // `mount(ctx)`、没经装配器时回落 `ctx.root`，与既有行为一致。
        const owner = rowOwnerOf(cordis);
        // **不交 deps 时给真 ctx**：上游 `Service` 的 `tracker.ctx` 由 cordis 按"定义处"记下，
        // 之后读它的子服务（`ctx.a.b`）就用那个 ctx。给代理会让子服务名在代理之外解析
        // （`uiSession.sessionStatus` 就是这样挂的）；不给 deps 的行本来就靠 store 满足依赖。
        usedDeps = withDeps(
          upstreamCtx,
          deps === undefined ? undefined : scopedDeps(owner, deps),
          () => {},
          undefined,
          cordis,
        );
        const instance = new upstream(usedDeps, effective);
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
        return instance;
      }
      // 上游发布的服务名与我们契约的连字符名几乎从不相同（`SessionStore` vs `sessions`）：
      // 记下它 provide 的名字，按名字取面，而不是拿契约名去 store 里猜。
      const provided: Array<{ name: string; value: unknown }> = [];
      const childFibers: Array<PromiseLike<unknown>> = [];
      const owner = rowOwnerOf(cordis);
      usedDeps = withDeps(
        upstreamCtx,
        deps === undefined ? undefined : scopedDeps(owner, deps),
        (name, value) => provided.push({ name, value }),
        (fiber) => childFibers.push(fiber),
        cordis,
      );
      const applied = await callApply(upstream, usedDeps, effective);
      // 等上游自己的子插件加载完：它们的 `provide` 发生在 `apply` 返回之后。
      await Promise.all(childFibers.map((fiber) => Promise.resolve(fiber).catch(() => undefined)));
      if (typeof applied === "function") {
        (ctx as unknown as { effect(fn: () => unknown): void }).effect(applied as () => unknown);
      }
      const contractName = tokenMetaOf(token as unknown as object).name;
      // 契约面只按**已注册的服务**取：`faceFromStore`（全局 store）与精确同名（`pickFace`）。
      // 上游 0.2.3 起有些服务在上游自己的 `ctx.inject` 回调里才 `new`（例如 `connection` 的
      // `HostConnectionService`），`apply` 返回时它还没注册——那就**不绑**：装配末尾的
      // `adoptNamedServices` 会按名字把它补进令牌表。这里不猜、不等、不盲取 `provided[0]`。
      this[kFace] =
        faceFromStore(cordis as unknown as Context, contractName) ??
        pickFace(provided, contractName);
      if (process.env["ZEPHYR_DEBUG_PROXY"] === "1") {
        const face = this[kFace] as Record<symbol, { ctx?: unknown }> | undefined;
        const trackedCtx = face?.[symbols.tracker]?.ctx;
        console.error(
          "[trace] %s：face.tracker.ctx === usedDeps? %s | === root? %s",
          tokenMetaOf(token as unknown as object).name,
          trackedCtx !== undefined && trackedCtx === usedDeps,
          trackedCtx === (ctx as unknown as Record<symbol, unknown>)[rootContextKey],
        );
      }
      // 适配行拿上游实例不要再读 `kFace`：`mount()` 的返回值就是它。
      return this[kFace];
    }
  }
  // 令牌来自**继承**（`extends 契约`）：`@Injectable()` 无参时复用父类的元数据，不再手工指定 token。
  Injectable()(Adapted);
  (Adapted as unknown as { token: TokenClass<unknown> }).token = token;
  return Adapted as unknown as AdaptedClass;
}
