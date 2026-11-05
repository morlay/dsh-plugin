// 会话**表层**的词汇（上游 `@deepseek-ai/dsh-session` 的 `surface` 面）：带 `surfaceOp` 的事件与折叠函数。
/** 带表层操作的事件（`surfaceOp` / `sourceEventSeqs` 只出现在它们上）。 */
export type { SurfaceEvent } from "@deepseek-ai/dsh-session";
/** 把日志折成「模型看得见的表层」（纯函数）。 */
export { foldSurface } from "@deepseek-ai/dsh-session/surface";
