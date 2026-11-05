// 会话日志的**写面词汇**（上游 `@deepseek-ai/dsh-session`）：表层事件类型与两件纯函数。
//
// 读侧/写侧都要它们：`SurfaceEventType` 给持久化落库时判「这条事件有没有 surfaceOp」，
// `interruptedTurnClosers` / `snapshotSessionEvent` 给修复与导出用（都是纯函数）。
/** 有表层语义的事件类型（`surfaceOp` 只出现在这些事件上）。 */
export type { SurfaceEventType } from "@deepseek-ai/dsh-session";
/** 一个被打断的回合要补哪些收尾事件（纯函数）。 */
export { interruptedTurnClosers } from "@deepseek-ai/dsh-session";
/** 取一条事件的快照（纯函数）。 */
export { snapshotSessionEvent } from "@deepseek-ai/dsh-session";
