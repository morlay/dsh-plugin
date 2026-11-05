// 会话域的**测试支撑**出口（`@morlay/dsh-session/testing`）：造数据的 fixtures、契约套件、最小装配。
//
// 下游域的 spec 从这里取，别在自己的 `__tests__/support` 里再造一份同形状的数据——那正是
// 「同一个 fixture 只在一个域存在」这条判据要挡的东西。
//
// **显式清单**（不用 `export *`）：测试面要能被一眼读完，也避免与别处的同名符号互相遮蔽。
export {
  appendLog,
  assistantMessage,
  meta,
  oneTurnLog,
  oneTurnLogStepFirst,
  secondTurn,
  turnLog,
  twoTurnLog,
  userMessage,
} from "./log.ts";
export { runCoordinatorContract } from "./coordinator-contract.ts";
export type { CoordinatorContext, CoordinatorFixture } from "./coordinator-contract.ts";
export { createSessionContext } from "./context.ts";
export type { SessionTestContext } from "./context.ts";
