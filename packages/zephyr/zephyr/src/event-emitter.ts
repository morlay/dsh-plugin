// 类型安全的事件：事件就是 `EventEmitter` 的**子类**（一个 `@Injectable()` 的 Provider），
// 名字、参数表、返回类型都写在类里。
//
// ```ts
// @Injectable()
// export class ToolExecute extends EventEmitter<[ToolDispatchExecution], Promise<ToolExecutionResult>> {
//   constructor() { super("tools/execute"); }
// }
//
// // 消费：与普通服务同构
// private readonly execute = inject(ToolExecute);
// onInit(): void {
//   this.execute.onWaterfall((exec, next) => next());
// }
// ```
//
// 为什么这样：cordis 的事件是字符串 + `Events` 接口增强，事件名拼错要到运行期才发现，
// 同名事件的 payload 参数表散在各处。这里把它们收进一个类，七种分发模式与 cordis 一一对齐。
//
// 拿 ctx 的方式是 `OnInit`：事件是 Provider，装配时 `onInit(ctx)` 拿到**本行 ctx**，
// 天然属于当前 app——没有全局单例、没有中间服务、也不用额外登记令牌。
import type { Context, OnInit } from "./injection.ts";

/** 监听器的注册选项（与 cordis 同形：`true` = prepend）。 */
export type EventOptions = boolean | { readonly prepend?: boolean };

/**
 * 瀑布里的 `next`：监听者调它把结果交给下一个监听者。
 *
 * 与 cordis 对齐成**无参**（`next()` 表示"照原样继续"）；需要替换结果的瀑布用它自己的事件类型表达。
 */
export type Next<TResult> = () => TResult;

/**
 * cordis ctx 的事件面（**内部类型**，不对外导出）。
 *
 * `ctx` 运行时就有这七个方法；类型上它们来自 cordis `events.ts` 的 `declare module './context.ts'`
 * 增强，`vendor` 不进 program 时那份增强不生效——所以在桥的边界断言一次，业务代码看不到它。
 */
interface EventBus {
  emit(name: string, ...args: unknown[]): void;
  parallel(name: string, ...args: unknown[]): Promise<void>;
  serial<R>(name: string, ...args: unknown[]): Promise<R>;
  bail<R>(name: string, ...args: unknown[]): R;
  waterfall<R>(name: string, ...args: unknown[]): R;
  on<A extends unknown[], R>(
    name: string,
    listener: (...args: A) => R,
    options?: EventOptions,
  ): () => boolean;
  once<A extends unknown[], R>(
    name: string,
    listener: (...args: A) => R,
    options?: EventOptions,
  ): () => boolean;
}

/**
 * 一个类型安全的事件。
 *
 * `TArgs` 是这个事件的**参数表**（不是单个 payload）：无参事件用默认的 `[]`，
 * 多参事件写 `[SessionId, boolean]`。`TResult` 是监听者的返回值
 * （`serial` / `bail` / `waterfall` 用得到；`emit` / `parallel` 忽略它）。
 */
export abstract class EventEmitter<
  in out TArgs extends unknown[] = [],
  in out TResult = void,
> implements OnInit {
  /** 本行 ctx：`onInit` 填。事件在 `onInit` 之前被调用属于装配顺序错误。 */
  private bus: EventBus | undefined;

  /**
   * @param name - cordis 的事件名（wire 上仍是字符串）。
   */
  protected constructor(readonly name: string) {}

  /**
   * 拿到本行 ctx 的事件面。
   * @param ctx - 本行的 cordis ctx。
   */
  onInit(ctx: Context): void {
    // 桥的边界：`ctx` 运行时就有这七个方法，类型上缺的是 cordis 的模块增强。
    this.bus = ctx as EventBus;
  }

  private get target(): EventBus {
    if (this.bus === undefined) {
      throw new Error(`EventEmitter "${this.name}" 在装配完成前被使用`);
    }
    return this.bus;
  }

  /** 广播：所有监听者同步跑一遍，返回值忽略。 */
  emit(...args: TArgs): void {
    this.target.emit(this.name, ...args);
  }

  /** 并行：所有监听者并发跑，全部结束后 resolve。 */
  async parallel(...args: TArgs): Promise<void> {
    await this.target.parallel(this.name, ...args);
  }

  /** 串行：按注册顺序逐个跑，返回**最后一个**监听者的结果。 */
  async serial(...args: TArgs): Promise<TResult> {
    return await this.target.serial<TResult>(this.name, ...args);
  }

  /** 短路：遇到第一个非 `undefined` 的结果就返回。 */
  bail(...args: TArgs): TResult {
    return this.target.bail<TResult>(this.name, ...args);
  }

  /**
   * 瀑布：每个监听者拿到 `next`，由它决定是否继续以及最终结果。
   * @param args - 这个事件的参数表。
   * @returns 最后一个监听者交回的结果。
   */
  waterfall(...args: TArgs): TResult {
    return this.target.waterfall<TResult>(this.name, ...args);
  }

  /**
   * 订阅。
   * @param listener - 回调参数与事件参数表一致。
   * @param options - 注册选项（`true` = prepend）。
   * @returns 退订函数。
   */
  on(listener: (...args: TArgs) => TResult, options?: EventOptions): () => boolean {
    return this.target.on(this.name, listener, options);
  }

  /**
   * 订阅**瀑布**监听者（比 `on` 多一个 `next` 参数）。
   *
   * `on` 的监听者签名是 `(...args: TArgs) => TResult`，瀑布的监听者多一个 `next`，
   * 两者不能共用一个类型位；用错方法会在编译期报出来。
   * @param listener - 参数表 + `next`。
   * @param options - 注册选项。
   * @returns 退订函数。
   */
  onWaterfall(
    listener: (...args: [...TArgs, Next<TResult>]) => TResult,
    options?: EventOptions,
  ): () => boolean {
    return this.target.on(this.name, listener, options);
  }

  /**
   * 订阅一次（触发后自动退订）。
   * @param listener - 回调参数与事件参数表一致。
   * @param options - 注册选项。
   * @returns 退订函数。
   */
  once(listener: (...args: TArgs) => TResult, options?: EventOptions): () => boolean {
    return this.target.once(this.name, listener, options);
  }
}
