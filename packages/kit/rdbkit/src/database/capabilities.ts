import { fragment } from "../fragment.ts";
import type { Database, SqlitePragmaName } from "./types.ts";

function assertPragmaName(name: SqlitePragmaName): void {
  if (name !== "user_version" && name !== "application_id" && name !== "journal_mode") {
    throw new Error(`rdbkit: unsupported pragma '${String(name)}'`);
  }
}

/** PRAGMA 不支持绑定参数，值只能内联：只放行整数与标识符形状的字符串。 */
function assertPragmaValue(name: SqlitePragmaName, value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`rdbkit: invalid pragma value '${String(value)}' for '${name}'`);
    }
    return String(value);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`rdbkit: invalid pragma value '${value}' for '${name}'`);
  }
  return value;
}

/** 现有的表与视图名（迁移探测旧表、拒绝别人的库都要它）。 */
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

/** 回收空间与统计（SQLite `VACUUM` / PostgreSQL `VACUUM ANALYZE`）；不得在事务内调用。 */
export async function vacuum(database: Database): Promise<void> {
  await database.run(
    fragment(database.dialect.name === "sqlite" ? "VACUUM" : "VACUUM ANALYZE"),
  );
}

/** 读 SQLite 的 `PRAGMA`（其它方言直接报不支持）。 */
export async function sqlitePragma(
  database: Database,
  name: SqlitePragmaName,
): Promise<string | number | undefined> {
  assertPragmaName(name);
  if (database.dialect.name !== "sqlite") {
    throw new Error(`rdbkit: '${name}' is a SQLite PRAGMA; this database is postgres`);
  }
  const rows = await database.read<Record<string, unknown>>(fragment(`PRAGMA ${name}`));
  const value = rows[0]?.[name];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

/** 写 SQLite 的 `PRAGMA`（值只允许安全字面量，见 `assertPragmaValue`）。 */
export async function setSqlitePragma(
  database: Database,
  name: SqlitePragmaName,
  value: string | number,
): Promise<void> {
  assertPragmaName(name);
  if (database.dialect.name !== "sqlite") {
    throw new Error(`rdbkit: '${name}' is a SQLite PRAGMA; this database is postgres`);
  }
  await database.run(fragment(`PRAGMA ${name} = ${assertPragmaValue(name, value)}`));
}
