// remote-access 的**读面**。
//
// 上游 `api/remote-access/client` 的实现从 `globalThis` 读注入基线（本仓规则不允许任何 global），
// 所以这里声明我们要的语义、由自己的实现兑现。
//
// 不变量：**本装配不设浏览器侧访问限制**（授权由 Host 决定），所以
// - `source(...)` 给「恒放行」的 observable；
// - `whenAccess` / `whenResourceAccess` 立刻安装回调的效果并按 disposer 撤销。
// 上游 `ui-*` 行（`ui-session` / `ui-schedule` / `ui-settings-general`）按名字调这两个成员守护副作用，
// 缺一个它们在运行期就是 `ctx.remoteAccess.whenAccess is not a function`。
import { Injectable } from "@morlay/zephyr";

/** 一次访问判定下要安装的效果：一个 disposer，或一组按装序逆序撤销的 disposer。 */
export type AccessEffect = (() => void) | Iterable<() => void>;

@Injectable()
export abstract class RemoteAccess {
  /**
   * 某个资源上是否允许某种操作。
   * @param kind - 资源类型（`"session"` 等）。
   * @param id - 资源 id。
   * @param action - 操作名。
   * @returns 「恒放行」的 observable（`getSnapshot(): true`）。
   */
  abstract source(kind: string, id: string, action: string): unknown;

  /**
   * 在「当前 Peer 可以调这个全局 endpoint」的判定下安装效果（上游 `whenAccess`）。
   *
   * 本装配恒放行：立刻安装，返回幂等 disposer（再调不再撤销第二次）。
   * @param action - endpoint 动作名（上游 `RemoteEndpoint`）。
   * @param callback - 创建要守护的效果。
   * @returns 观测与已安装效果一起撤销的 disposer。
   */
  abstract whenAccess(action: string, callback: () => AccessEffect): () => void;

  /**
   * `whenAccess` 的一个资源版本（上游 `whenResourceAccess`）。
   *
   * 本装配里与 `whenAccess` 同义：资源判定同样恒放行。
   * @param kind - 资源类型。
   * @param id - 资源 id。
   * @param action - endpoint 动作名。
   * @param callback - 创建要守护的效果。
   * @returns 撤销用的 disposer。
   */
  abstract whenResourceAccess(
    kind: string,
    id: string,
    action: string,
    callback: () => AccessEffect,
  ): () => void;
}
