// 换树前的**忙不忙**：谁忙是各域自己的事实，换树的实现只做汇总。
//
// 为什么是多值令牌而不是往 `DevHmr` 的钩子里叠一个回调：`agent/pre-step` 开着 turn、后台任务在跑，
// 这些都是**域**的事实；装配面若为此写一份「哪个令牌算忙」的知识，每加一个域就要改一处装配面。
// 各域在自己的 `provideXxx()` 里登记一条实现，`DevHmr` 的实现用 `inject.all` 收全部。
//
// 这条缝只在开发态有意义（换树是开发运行时的事）：生产形态没人装实现，
// 因此消费方要按**可选多值**处理——一条都没有就当作空闲。
import { Injectable } from "@morlay/zephyr";

/** 一个域的空闲判据（多值令牌）。 */
@Injectable({ multi: true })
export abstract class IdleGuard {
  /**
   * 这个域现在有没有在途的事。
   * @returns 空闲为 `true`（任一实现说 `false`，换树就要等）。
   */
  abstract isIdle(): boolean;
}
