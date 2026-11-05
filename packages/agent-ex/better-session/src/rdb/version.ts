/** 库结构版本（写入 SQLite 的 `user_version`，不匹配即拒绝打开）。 */
export const SCHEMA_VERSION = 3;

/** SQLite 文件头的 application id（`0x44534850` = "DSHP"），防止误开别的库。 */
export const SESSION_PERSISTENCE_SQLITE_APPLICATION_ID = 0x44534850;

/** 事件 `f_data` 的编码（目前只有 JSON）。 */
export const EVENT_ENCODING = "json";

export type JournalMode = "wal" | "delete" | "truncate" | "persist";

/** SQLite 的默认 busy timeout（毫秒）。 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;
