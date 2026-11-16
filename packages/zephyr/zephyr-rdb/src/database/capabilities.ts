import { concat, fragment, text, type Fragment } from "../fragment.ts";
import type { Database, SqlitePragmaName } from "./types.ts";

function assertPragmaName(name: SqlitePragmaName): void {
  if (name !== "user_version" && name !== "application_id" && name !== "journal_mode") {
    throw new Error(`zephyr-rdb: unsupported pragma '${String(name)}'`);
  }
}

// PRAGMA 不支持绑定参数，值只能内联：只放行整数与标识符形状的字符串。
function assertPragmaValue(name: SqlitePragmaName, value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`zephyr-rdb: invalid pragma value '${String(value)}' for '${name}'`);
    }
    return String(value);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`zephyr-rdb: invalid pragma value '${value}' for '${name}'`);
  }
  return value;
}

// 查询计划：两方言的 `EXPLAIN` 文本不同，统一成「计划行数组」（SQLite 取 `detail`、PostgreSQL 取
// `QUERY PLAN`），值的口径仍是方言原文。
export async function explain(database: Database, query: Fragment): Promise<string[]> {
  const prefix = text(
    database.dialect.name === "sqlite" ? "EXPLAIN QUERY PLAN" : "EXPLAIN (FORMAT TEXT)",
  );
  const rows = await database.read<Record<string, unknown>>(concat([prefix, query], " "));
  const key = database.dialect.name === "sqlite" ? "detail" : "QUERY PLAN";
  return rows.map((row) => String(row[key]));
}

// 现有的表与视图名（迁移探测旧表、拒绝别人的库都要它）。
export async function objectNames(database: Database): Promise<string[]> {
  const query =
    database.dialect.name === "sqlite"
      ? fragment(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
        )
      : fragment(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = COALESCE(?, current_schema())",
          [database.schema ?? null],
        );
  const rows = await database.read<{ name: string }>(query);
  return rows.map((row) => row.name);
}

// 现有的表名（不含视图，也不含 SQLite 的 `sqlite_*` 内部表）：结构漂移的 orphan 判定用它，
// 两个方言同一口径——只认真正的表（`objectNames` 把视图也算进来，是另一件事）。
export async function tableNames(database: Database): Promise<string[]> {
  const query =
    database.dialect.name === "sqlite"
      ? fragment("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      : fragment(
          "SELECT table_name AS name FROM information_schema.tables " +
            "WHERE table_schema = COALESCE(?, current_schema()) AND table_type = 'BASE TABLE'",
          [database.schema ?? null],
        );
  const rows = await database.read<{ name: string }>(query);
  return rows.map((row) => row.name);
}

// 回收空间与统计（SQLite `VACUUM` / PostgreSQL `VACUUM ANALYZE`）；不得在事务内调用。
export async function vacuum(database: Database): Promise<void> {
  await database.run(fragment(database.dialect.name === "sqlite" ? "VACUUM" : "VACUUM ANALYZE"));
}

// 读 SQLite 的 `PRAGMA`（其它方言直接报不支持）。
export async function sqlitePragma(
  database: Database,
  name: SqlitePragmaName,
): Promise<string | number | undefined> {
  assertPragmaName(name);
  if (database.dialect.name !== "sqlite") {
    throw new Error(`zephyr-rdb: '${name}' is a SQLite PRAGMA; this database is postgres`);
  }
  const rows = await database.read<Record<string, unknown>>(fragment(`PRAGMA ${name}`));
  const value = rows[0]?.[name];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

// 写 SQLite 的 `PRAGMA`（值只允许安全字面量，见 `assertPragmaValue`）。
export async function setSqlitePragma(
  database: Database,
  name: SqlitePragmaName,
  value: string | number,
): Promise<void> {
  assertPragmaName(name);
  if (database.dialect.name !== "sqlite") {
    throw new Error(`zephyr-rdb: '${name}' is a SQLite PRAGMA; this database is postgres`);
  }
  await database.run(fragment(`PRAGMA ${name} = ${assertPragmaValue(name, value)}`));
}
