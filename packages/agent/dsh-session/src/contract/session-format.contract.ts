// 会话日志**文件格式**的契约词汇：header / 事件的 JSON 形状、每代格式的文件名、以及格式目录。
//
// 上游把这一层拆成 `-format`（一代格式的读写与文件名）与 `-format-catalog`（把若干代格式与迁移链
// 组成一个目录）。落盘实现要按文件名认出「这是第几代」，所以要这两组词；这里一处给全。
/** 一条落盘事件的 JSON 形状（写入磁盘的那份，不是内存里的事件）。 */
export type { SessionFormatEvent } from "@deepseek-ai/dsh-session-format";
/** 一份落盘 header 的 JSON 形状。 */
export type { SessionFormatHeader } from "@deepseek-ai/dsh-session-format";
/** 某一代格式的日志文件名（纯函数）。 */
export { sessionFormatLogFilename } from "@deepseek-ai/dsh-session-format";
/** 从日志文件名认出它是第几代格式（认不出给 `undefined`，纯函数）。 */
export { parseSessionFormatLogFilename } from "@deepseek-ai/dsh-session-format";
/** 把「本代格式 + 各代迁移」组成一个可读旧日志的格式目录（纯函数）。 */
export { createSessionFormatCatalogWithChildren } from "@deepseek-ai/dsh-session-format-catalog";
/** 本仓当前这一份格式目录实例。 */
export { sessionFormatCatalog } from "@deepseek-ai/dsh-session-format-catalog";
