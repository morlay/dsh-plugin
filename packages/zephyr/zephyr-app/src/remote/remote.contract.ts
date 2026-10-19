// Remote 的装载面（上游 `api-gateway` client 半提供的 `remote`）。
//
// namespace 不在这里列举，也不提供任何「按名字查」的方法（那是 service locator）：
// 每个 namespace 用 `@RemoteContract` / `@RemoteImpl` 这一对语法糖各自成契约（见
// `client/remote/remote.decorator.ts`）。这一层只给上游面本身与装载面。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Remote {
  /**
   * 上游实例本身（`remote.<group>.<method>` 就在它上面）。
   *
   * **只给框架的 `@RemoteGroup` 转发用**：业务代码一律调契约方法，不要读它。
   */
  abstract readonly upstream: Record<string, unknown>;

  /** 挂一个 Remote contribution；返回它的 disposer。 */
  abstract $mount(contribution: unknown): Promise<() => Promise<void>>;

  /**
   * 等「第一次 `$mount` 完成」。
   *
   * 读数据的一方要等 descriptor 就位——否则 `remote.<ns>` 还不存在，调用会被 `?.` 静默吞掉。
   * @returns 挂载完成（或永远不会挂载时的 reject 由调用方决定）。
   */
  abstract whenMounted(): Promise<void>;

  /**
   * 等某个 namespace 被某个 `$mount` 登记。
   *
   * 多个 contribution 各自 `$mount`（session / workspace…），`whenMounted` 只等第一个；
   * 依赖后一个 namespace 的一方必须按名字等，否则「先到的是别的 namespace」这条竞态会静默成空态。
   * @param namespace - 上游 namespace 名（`workspace`）。
   * @returns 该 namespace 至少注册了一个方法。
   */
  abstract whenNamespace(namespace: string): Promise<void>;

  /**
   * 订阅一个推送频道（`api-session/added` 之类）；返回退订函数。
   *
   * 监听者的**返回值是应答**：单向频道（`emit`）忽略它；可应答频道（`waterfall`，如 `approval/request`）
   * 用它回答宿主——`RemoteEventReply` 的 `result` / `rejected` 直接生效，**返回 `undefined` 等价于 `next`**
   * （放行到下一个监听者或宿主默认行为）。
   * @param channel - 频道名（见 `MuxServer` 的转发事件表）。
   * @param listener - 收到一帧时调用；返回值即应答。
   * @returns 退订函数。
   */
  abstract $on(channel: string, listener: (...args: never[]) => unknown): () => void;

  /**
   * 打开一个**流式** remote 方法（与上游 `remote.$stream` 同形）。
   *
   * 上游契约是：传 `{ name, args, signal? }`，返回 `AsyncIterable<RemoteStreamItem<T>>`，
   * 且带 `dispose()`。消费方（`ui-session`、`workspace-controller`）都按这个形状迭代。
   * @param options - 流参数（名字 + 实参 + 可选中断信号）。
   * @returns `AsyncIterable` 且带 `dispose`。
   */
  abstract $stream(options: {
    readonly name: string;
    readonly args?: readonly unknown[];
    readonly signal?: AbortSignal;
  }): AsyncIterable<unknown> & { dispose(): Promise<void> };
}
