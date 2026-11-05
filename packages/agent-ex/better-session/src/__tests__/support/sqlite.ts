// sqlite 的**同步句柄**：先把库初始化（建表 / 迁移 / 身份），再给一个同步口——造损坏数据、读 `PRAGMA` 用。
//
// 同步口只在测试里存在：生产路径拿到的永远是 `Database`。造日志的 fixtures 在
// `@morlay/dsh-session/testing`，契约套件在 `@morlay/dsh-session-persistence/testing`。
import { DatabaseSync } from "node:sqlite";
import { openSqliteHandle } from "@morlay/zephyr-rdb/testing";
import { DEFAULT_BUSY_TIMEOUT_MS, openRdbBackend } from "@morlay/better-session";
import type { JournalMode as QuestJournalMode } from "@morlay/better-session";

/**
 * 打开一份已初始化的 sqlite 库的同步句柄。
 * @param path - 库文件路径。
 * @param journalMode - 日志模式（默认 wal）。
 * @param busyTimeout - 忙等上限（默认与实现同一个常量）。
 * @returns 同步句柄（调用方负责 `close()`）。
 */
export async function openInitializedSqlite(
  path: string,
  journalMode: QuestJournalMode = "wal",
  busyTimeout = DEFAULT_BUSY_TIMEOUT_MS,
): Promise<DatabaseSync> {
  const backend = await openRdbBackend({ type: "sqlite", path, journalMode, busyTimeout });
  await backend.close();
  return openSqliteHandle(path, { journalMode, busyTimeout });
}
