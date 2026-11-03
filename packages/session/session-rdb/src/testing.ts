import type { DatabaseSync } from "node:sqlite";
import { openSqliteHandle } from "@morlay/rdbkit/testing";
import { openRdbBackend } from "./backend-rdb.ts";
import { DEFAULT_BUSY_TIMEOUT_MS, type JournalMode } from "./version.ts";

export type { ContractBackend } from "./testing/contract.ts";
export { appendLog, meta, oneTurnLog, runPersistenceContract } from "./testing/contract.ts";
export type { CoordinatorFixture } from "./testing/coordinator-contract.ts";
export { runCoordinatorContract } from "./testing/coordinator-contract.ts";

export { truncateLiveSession } from "./branch/index.ts";

/**
 * 测试辅助：先把库初始化（建表 / 迁移 / 身份），再给一个同步句柄——造损坏数据、读 `PRAGMA` 用。
 *
 * 同步口只在测试里存在：生产路径拿到的永远是 `Database`。
 */
export async function openInitializedSqlite(
  path: string,
  journalMode: JournalMode = "wal",
  busyTimeout = DEFAULT_BUSY_TIMEOUT_MS,
): Promise<DatabaseSync> {
  const backend = await openRdbBackend({ type: "sqlite", path, journalMode, busyTimeout });
  await backend.close();
  return openSqliteHandle(path, { journalMode, busyTimeout });
}
