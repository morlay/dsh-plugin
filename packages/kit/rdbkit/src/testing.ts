import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Client } from "pg";

/**
 * 测试专用句柄：造损坏数据、读 `PRAGMA` 这类只有同步驱动才做得到的事。
 *
 * 生产路径不经过这里——业务侧拿的是 `Database`（`openDatabase`），没有同步口。
 * @param path - SQLite 库文件路径。
 * @param options - 与打开库时一致的 busy timeout / journal mode。
 * @returns 同步句柄（用完要 `close()`）。
 */
export function openSqliteHandle(
  path: string,
  options: { journalMode?: string; busyTimeout?: number } = {},
): DatabaseSync {
  const client = new DatabaseSync(path);
  client.exec(`PRAGMA busy_timeout = ${options.busyTimeout ?? 5000}`);
  if (options.journalMode !== undefined) client.exec(`PRAGMA journal_mode = ${options.journalMode}`);
  return client;
}

/** 一个临时的 PostgreSQL 测试库：用完必须 `drop()`。 */
export interface PostgresTestDatabase {
  connectionString: string;
  drop: () => Promise<void>;
}

/**
 * 建一个随机名的 PostgreSQL 测试库（用完 drop）。
 *
 * 建库是管理面操作：业务侧的 `Database` 不提供它，测试要独立库时用这里。
 * @param options - `adminUrl` 指向有建库权限的连接串；省略时读 `TEST_PG_URL`。
 * @returns 指向新库的连接串与清理函数。
 */
export async function createPostgresTestDatabase(
  options: { adminUrl?: string } = {},
): Promise<PostgresTestDatabase> {
  const adminUrl =
    options.adminUrl ??
    process.env["TEST_PG_URL"] ??
    "postgres://postgres:postgres@localhost:25433/postgres";
  const name = `dsh_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    connectionString: url.toString(),
    drop: async () => {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
