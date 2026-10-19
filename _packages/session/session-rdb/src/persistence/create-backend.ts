// 行配置 → 具体 backend：sqlite / postgres 两个实现的选择只在这里。
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { Backend } from "../backend.ts";
import { DEFAULT_BUSY_TIMEOUT_MS } from "../schema.ts";
import { PostgresBackend } from "../postgres.ts";
import { SqliteBackend } from "../sqlite.ts";
import type { Config } from "./config.ts";

export function createBackend(config: Config): Backend {
  if (config.type === "sqlite") {
    return new SqliteBackend({
      path: config.path,
      journalMode: config.journalMode ?? "wal",
      busyTimeout: config.busyTimeout ?? DEFAULT_BUSY_TIMEOUT_MS,
    });
  }
  const pool = new Pool({ connectionString: config.connectionString });

  pool.on("error", () => {});
  const db = drizzlePg({ client: pool });
  const identityBase = [
    "postgres",
    pool.options.host ?? "localhost",
    String(pool.options.port ?? 5432),
    pool.options.database ?? "",
    config.schema ?? "public",
  ].join(":");
  return new PostgresBackend(db, {
    identityBase,
    schema: config.schema ?? "public",
    close: () => pool.end(),
  });
}
