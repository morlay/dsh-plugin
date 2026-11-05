// Remote 方法的**路由表**：`<namespace>/<method>` → 处理器，外加一条事件通道。
//
// 为什么不用上游 `gateway.invoke`：它按**全局服务名**（`ctx.get('sessionController')`）找实现，
// 而全局名在我们这套「每行一个作用域」的装配里没法可靠地落位。这里改成显式注册：
// 谁提供服务，谁在 `onInit` 里 `register('<ns>/<method>', handler)`，路由表就是完整的真相。
//
// home 在装配层（`zephyr-app`）：业务包是注册方（`register` / `publish`），装配层是消费方
// （mux server 按表分发）；实现 `RemoteHandlersDefault` 同目录。DI 核心不认识 remote 这件事。
import { Injectable } from "@morlay/zephyr";

/** 一个 Remote 方法的处理器。 */
export type RemoteHandler = (args: Readonly<Record<string, unknown>>) => Promise<unknown>;

/** 一个流式 Remote 方法的处理器：逐帧产出，`signal` 被取消时应当结束。 */
export type RemoteStreamHandler = (
  args: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => AsyncIterable<unknown>;

/** 事件监听者（宿主推给客户端的 `api-session/*` 之类）。 */
export type RemoteEventListener = (...args: readonly unknown[]) => void;

@Injectable()
export abstract class RemoteHandlers {
  /**
   * 注册一个 Remote 方法。
   * @param endpoint - `<namespace>/<method>`。
   * @param handler - 收到命名参数后返回结果。
   * @returns 注销函数。
   */
  abstract register(endpoint: string, handler: RemoteHandler): () => void;

  /**
   * 注册一个**流式** Remote 方法（`workspace/follow` 这类）。
   * @param endpoint - `<namespace>/<method>`。
   * @param handler - 收到命名参数与取消信号后逐帧产出。
   * @returns 注销函数。
   */
  abstract registerStream(endpoint: string, handler: RemoteStreamHandler): () => void;

  /**
   * 取一个已注册的流式方法（没注册就是 `undefined`，调用方按 unary 处理）。
   * @param endpoint - `<namespace>/<method>`。
   * @param args - 命名参数。
   * @param signal - 取消信号（客户端发 `cancel` / socket 断开时 abort）。
   * @returns 帧序列。
   */
  abstract stream(
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): AsyncIterable<unknown> | undefined;

  /**
   * 调一个已注册的 Remote 方法。
   * @param endpoint - `<namespace>/<method>`。
   * @param args - 命名参数。
   * @returns 处理器结果。
   */
  abstract invoke(endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;

  /**
   * 订阅一条事件频道。
   * @param channel - 频道名（`api-session/added` 之类）。
   * @param listener - 收到一帧时调用。
   * @returns 退订函数。
   */
  abstract subscribe(channel: string, listener: RemoteEventListener): () => void;

  /**
   * 发布一帧事件（宿主侧状态变化时调用）。
   * @param channel - 频道名。
   * @param args - 帧载荷。
   */
  abstract publish(channel: string, ...args: readonly unknown[]): void;

}
