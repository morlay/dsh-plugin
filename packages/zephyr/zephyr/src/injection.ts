// 生命周期与 ctx 的类型面。运行期语义全归 cordis：`Context` 就是 cordis 的 ctx。
//
// 上游类型的用法：**能直接用的直接用**（`extends CordisContext`、`Fiber` / `ReflectService` /
// `LoggerService` 原样引用），只补它缺的那一个成员。
//
// 缺的那个是 `logger`：cordis 的部分成员靠 `declare module './context.ts'` 的模块增强挂上来，
// 增强是否生效取决于哪些文件被编进 program；`vendor/**` 不在我们的 program 里（A 决定：上游源码
// 用自己的宽松口径，不吃我们的 strict），所以 `logger` 在这里显式补一次。其余成员（`reflect` /
// `effect` / `extend` / `plugin` / `on` / `emit` / `waterfall` / `isolate`）都由 `context.ts` /
// `fiber.ts` 的类声明本身提供，不需要重复。
import type { Context as CordisContext, Fiber } from "@deepseek-ai/cordis";
import type { LoggerService } from "@deepseek-ai/cordis/src/logger.ts";
import type { ReflectService } from "@deepseek-ai/cordis/src/reflect.ts";

/** 可同步或异步返回。 */
export type Awaitable<T> = T | Promise<T>;

/** 可构造的类型（配置类、Provider 类）。 */
export type Newable<T> = new (...args: never[]) => T;

/** 契约类的构造面：`inject(Foo)` 的目标。 */
export type TokenClass<T> = abstract new (...args: never[]) => T;

/** 一次调用的撤销面（`ctx.effect` 的返回值）：可等待，也可直接当函数调。 */
export interface ContextDisposable extends PromiseLike<void> {
  (): Promise<void>;
}

/** cordis 的 fiber 面：直接用上游类型，不挑成员。 */
export type ContextFiber = Fiber;

/** cordis 的 reflect 面：`reflect.ts` 没从包入口导出，走 `./src/*` 的子路径。 */
export type ContextReflect = ReflectService;

/** 日志面：上游 `LoggerService`。 */
export type ContextLogger = LoggerService;

/**
 * Provider 的行 ctx：运行时是 cordis 子 ctx。
 *
 * 只声明我们真正用到的成员（见 `packages/zephyr/zephyr/src` 与各域的实际调用）；上游插件拿到的
 * 也是同一个对象，它们按 cordis 的完整面用——那是它们的类型，不是我们的。
 */
export interface Context extends CordisContext {
  /** 日志面：cordis 的 `logger` 靠模块增强挂上来，这里显式给出。 */
  readonly logger: LoggerService;
  /** 根 ctx（服务注册在它上面才跨行可见）。 */
  readonly root: Context;
  /** 反射层：`ctx.get` / `ctx.provide` 的底座（cordis 里是模块增强挂的）。 */
  readonly reflect: ReflectService;
  /**
   * 按名字读服务（cordis 用 `mixin` 挂上来的，见 `vendor/…/cordis/src/reflect.ts`）。
   *
   * 这里显式声明一次：不声明的话每次读按名字的服务都得 `(ctx as unknown as { get(...) }).get(...)`
   * ——那两个包里这类断言有十几处。返回 `unknown` 而不是上游的 `any`：调用方本来就该自己收窄，
   * 别让 `any` 顺着断言传下去。
   * @param name - 服务名。
   * @param strict - 缺省 `true`（读不到就抛）；`false` 读不到给 `undefined`。
   * @returns 该服务的实例（未收窄）。
   */
  get(name: string, strict?: boolean): unknown;
  /**
   * 发布一个服务名（cordis 的 store 是唯一注册表，是 `get` 的写面对）。
   *
   * 与 `get` 同一个理由：这份增强是否在 program 里取决于编译了哪些文件——不在这里声明一次，
   * 按名字发布服务的每处都要 `(ctx as unknown as { provide(...) })`。
   * @param name - 服务名（可以带点，如 `remote.session`）。
   * @param value - 服务实例。
   * @returns 撤销发布的函数。
   */
  provide(name: string, value?: unknown): () => void;
  /**
   * 等一组服务就绪再跑回调（cordis 的 `ctx.inject`，与上面的增强同一来源）。
   *
   * 已经存在的服务立即回调，稍后出现的等到出现——两种时机都由 cordis 的 fiber 保证。
   * `deps` 的类型放宽到「名字数组或名字 → config 的表」：两者都是 cordis 的 `Inject` 形状。
   * @param deps - 依赖的服务名。
   * @param callback - 就绪后的回调（收到挂上这些依赖的子 ctx）；返回值是撤销函数。
   * @returns fiber（可 await）。
   */
  inject(
    deps: readonly string[] | Readonly<Record<string, unknown>>,
    callback: (scoped: Context) => (() => void) | void,
  ): Fiber & PromiseLike<Fiber>;
  /**
   * 事件面：cordis 的 `emit` / `on` / `waterfall` 等**不在 `context.ts` 的类里**，而在
   * `events.ts` / `fiber.ts` 的 `declare module './context.ts'` 增强里；`vendor` 不进 program 时
   * 那些增强不生效，运行期却确实有这些方法。这里按 cordis 的实际形状补上（业务代码不直接用它们，
   * 见 `EventEmitter`——它拿 `ctx` 当事件桥）。
   */
  emit(event: string, ...args: unknown[]): void;
  parallel(event: string, ...args: unknown[]): Promise<void>;
  serial<R>(event: string, ...args: unknown[]): Promise<R>;
  bail<R>(event: string, ...args: unknown[]): R;
  waterfall<R>(event: string, ...args: unknown[]): R;
  /**
   * 带派发接收者的形态：cordis 的事件面第一个参数位是「监听器的 this」，对象/函数时被取走
   * （见 cordis 的 `EventsService._resolve`），监听器的过滤也按它判定——scope carrier 就挂在这里。
   * @param thisArg - 监听器的 this（也就决定哪些监听器被调用）。
   * @param event - 事件名。
   * @param args - 监听器参数，最后一个是 next。
   * @returns 最外层监听器的返回值。
   */
  waterfall<R>(thisArg: object, event: string, ...args: unknown[]): R;
  on<A extends unknown[], R>(
    event: string,
    listener: (...args: A) => R,
    options?: boolean | { readonly prepend?: boolean },
  ): () => boolean;
  once<A extends unknown[], R>(
    event: string,
    listener: (...args: A) => R,
    options?: boolean | { readonly prepend?: boolean },
  ): () => boolean;
  /** 装子插件；返回 fiber（可 await，`ctx` 是子 ctx）。 */
  plugin(plugin: unknown, config?: unknown): Fiber & PromiseLike<Fiber>;
  /** 注册一个 effect；返回可等待的撤销面。 */
  effect(body: () => unknown): ContextDisposable;
  /** 派生一个子 ctx（`meta` 里的字段直接落到新 ctx 上）。 */
  extend(meta?: object): Context;
  /** 派生一个隔离分区的子 ctx。 */
  isolate(name: string, label?: symbol): Context;
}

/** 装配后要挂行为。 */
export interface OnInit {
  /**
   * @param ctx - 本行的 cordis ctx。
   */
  onInit(ctx: Context): Awaitable<void>;
}

/** 卸载时收尾。 */
export interface OnDispose {
  onDispose(): Awaitable<void>;
}

/** Provider 可选实现的两种生命周期。 */
export type Lifecycle = Partial<OnInit & OnDispose>;
