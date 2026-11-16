import { identityFingerprint } from "@morlay/zephyr-rdb";

/** 库结构版本（写入 SQLite 的 `user_version`，不匹配即拒绝打开）。 */
export const SCHEMA_VERSION = 3;

/** 本库的库身份名（rdbkit 把它折成 SQLite 的 application_id / PG 的 schema 注释指纹）。 */
export const SESSION_LIBRARY_NAME = "dsh-session";

/** 库身份的 32 位指纹（SQLite 写在 application_id 上；常量名保留给消费方与用例）。 */
export const SESSION_PERSISTENCE_SQLITE_APPLICATION_ID =
  identityFingerprint(SESSION_LIBRARY_NAME) | 0;

/** 事件 `f_data` 的编码（目前只有 JSON）。 */
export const EVENT_ENCODING = "json";

export type JournalMode = "wal" | "delete" | "truncate" | "persist";

/** SQLite 的默认 busy timeout（毫秒）。 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;
