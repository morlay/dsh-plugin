// 落盘**句柄与失败**的词汇（上游 `@deepseek-ai/dsh-session-persistence`）。
//
// 实现（jsonl / RDB）要抛同一批错误、收同一批 Options；两者都是两端共用面的一部分。
export type {
  SessionAccess,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceStatOptions,
} from "@deepseek-ai/dsh-session-persistence";

/** 同一个 id 已经有一份落盘。 */
export { SessionAlreadyExistsError } from "@deepseek-ai/dsh-session-persistence";
/** 写所有权已被别的句柄持有。 */
export { SessionAlreadyOwnedError } from "@deepseek-ai/dsh-session-persistence";
/** 句柄已关。 */
export { SessionHandleClosedError } from "@deepseek-ai/dsh-session-persistence";
/** 会话不存在。 */
export { SessionPersistenceNotFoundError } from "@deepseek-ai/dsh-session-persistence";
/** 读句柄上的写操作。 */
export { SessionReadOnlyError } from "@deepseek-ai/dsh-session-persistence";

/** 造一份落盘 header（纯函数）。 */
export { materializeCreateHeader } from "@deepseek-ai/dsh-session-persistence";
/** 一批追加要写成的行（纯函数）。 */
export { materializeAppendBatch } from "@deepseek-ai/dsh-session-persistence";
/** 校验一批事件是否连续（纯函数）。 */
export { assertContiguous } from "@deepseek-ai/dsh-session-persistence";
