import { identityFingerprint } from "@morlay/zephyr-rdb";

/** 库结构版本（写入 SQLite 的 `user_version`，不匹配即拒绝打开）。 */
export const SCHEMA_VERSION = 3;

/** 本库的库身份名（rdbkit 把它折成 SQLite 的 application_id / PG 的 schema 注释指纹）。 */
export const SESSION_LIBRARY_NAME = "dsh-session";

/**
 * 库身份的 32 位指纹，**写入值**（SQLite 写在 application_id 上；常量名保留给消费方与用例）。
 *
 * 这是有符号 int32：`PRAGMA application_id` 只收 int32，写成无符号的 4214930297 会被 SQLite
 * 静默写成 0（身份就没了）。读回来的是同一段 32 位的无符号口径，所以比较前一律归一——
 * 见 `store/identity.ts` 的 `normalizeApplicationId`。
 */
export const SESSION_PERSISTENCE_SQLITE_APPLICATION_ID =
  identityFingerprint(SESSION_LIBRARY_NAME) | 0;

/**
 * 本库更早版本写在 `application_id` 上的旧身份：ASCII "DSHP"（`0x44534850` = 1146308688）。
 *
 * 打开时认作**自己的旧库**并就地升级成当前指纹；不认识的 id 仍按 SESSION_STORAGE_INCOMPATIBLE 拒绝。
 */
export const LEGACY_SESSION_PERSISTENCE_SQLITE_APPLICATION_ID = 0x44534850;

/** 事件 `f_data` 的编码（目前只有 JSON）。 */
export const EVENT_ENCODING = "json";

export type JournalMode = "wal" | "delete" | "truncate" | "persist";

/** SQLite 的默认 busy timeout（毫秒）。 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;
