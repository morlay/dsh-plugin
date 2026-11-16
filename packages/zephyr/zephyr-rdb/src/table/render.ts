import type { ColumnDef, TableDef } from "../defs.ts";
import { concat, fragment, param, readBigInts, text, type Fragment } from "../fragment.ts";
import { operandSql, type Condition, type Operand } from "../expr.ts";

// 写语句的列必须是表定义里的列：拼错的列名（或多带的调试字段）会静默被过滤掉。
function assertKnownColumns(table: TableDef, columns: readonly string[], operation: string): void {
  const unknown = columns.filter((name) => table.columns[name] === undefined);
  if (unknown.length === 0) return;
  throw new Error(
    `zephyr-rdb: ${operation} into "${table.name}" got unknown column(s) ${unknown.join(", ")}`,
  );
}

// 枚举列（`values`）在构造期校验：把非法值留给数据库 CHECK，报错会晚一步且不说是哪一列。
function assertEnumValues(table: TableDef, row: Record<string, unknown>, operation: string): void {
  for (const [name, value] of Object.entries(row)) {
    const allowed = table.columns[name]?.values;
    if (allowed === undefined || value === null || value === undefined) continue;
    if (typeof value === "string" && allowed.includes(value)) continue;
    throw new Error(
      `zephyr-rdb: ${operation} into "${table.name}" column '${name}' must be one of ${allowed.join(", ")}, got ${typeof value === "string" ? value : JSON.stringify(value)}`,
    );
  }
}

// JSON 列的绑定值：结构化值写成文本（SQLite 存 TEXT，PostgreSQL 的 JSONB 收文本参数）。
function bindValue(column: ColumnDef | undefined, value: unknown): unknown {
  if (
    column?.type === "json" &&
    value !== null &&
    value !== undefined &&
    typeof value !== "string"
  ) {
    return JSON.stringify(value);
  }
  return value;
}

// `RETURNING` 列里有 `bigint` 时给整条语句打 BigInt 读取标：SQLite 的开关是语句级，
// 只能整条打开，列级别的还原由 `normalize.ts` 按列定义做。
export function returningClause(table: TableDef, returning?: readonly string[]): Fragment | string {
  if (returning === undefined || returning.length === 0) return "";
  const clause = text(`RETURNING ${returning.map((name) => `"${name}"`).join(", ")}`);
  return returning.some((name) => table.columns[name]?.type === "bigint")
    ? readBigInts(clause)
    : clause;
}

// `target` 是已经按方言算好的表引用（PostgreSQL 带 schema，SQLite 就是表名）：
// 渲染层只拼接，不再自己决定落在哪个 schema。
export function insertOf(
  table: TableDef,
  target: string,
  row: Record<string, unknown>,
  mode: "insert" | "ignore" | "upsert",
  conflict?: readonly string[],
  update?: readonly string[],
  returning?: readonly string[],
): Fragment {
  // 列不在定义里就 fail loud：静默过滤等于把写错列名的数据悄悄丢掉（可空列尤其难发现）。
  assertKnownColumns(table, Object.keys(row), "insert");
  assertEnumValues(table, row, "insert");
  const columns = Object.keys(row);
  if (columns.length === 0)
    throw new Error(`zephyr-rdb: insert into "${table.name}" has no columns`);
  const sql =
    `INSERT INTO ${target} (${columns.map((name) => `"${name}"`).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})`;
  const base = fragment(
    sql,
    columns.map((name) => bindValue(table.columns[name], row[name])),
  );
  if (mode === "insert") return concat([base, returningClause(table, returning)], " ");
  const conflictTarget = (conflict ?? []).map((name) => `"${name}"`).join(", ");
  if (mode === "ignore") return concat([base, `ON CONFLICT (${conflictTarget}) DO NOTHING`], " ");
  const updates =
    (update ?? []).length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET ${(update ?? [])
          .map((name) => `"${name}" = excluded."${name}"`)
          .join(", ")}`;
  return concat(
    [base, `ON CONFLICT (${conflictTarget}) ${updates}`, returningClause(table, returning)],
    " ",
  );
}

export function insertManyOf(
  table: TableDef,
  target: string,
  rows: readonly Record<string, unknown>[],
  options: { conflict?: readonly string[]; update?: readonly string[] } = {},
): Fragment {
  if (rows.length === 0) return fragment("SELECT 1 WHERE 1 = 0");
  for (const row of rows) {
    assertKnownColumns(table, Object.keys(row), "insertMany");
    assertEnumValues(table, row, "insertMany");
  }
  const columns = Object.keys(rows[0]!);
  if (columns.length === 0)
    throw new Error(`zephyr-rdb: insert into "${table.name}" has no columns`);
  for (const row of rows) {
    for (const column of columns) {
      if (row[column] === undefined) {
        throw new Error(
          `zephyr-rdb: insertMany into "${table.name}" is missing column '${column}'`,
        );
      }
    }
  }
  const tuple = `(${columns.map(() => "?").join(", ")})`;
  const sql =
    `INSERT INTO ${target} (${columns.map((name) => `"${name}"`).join(", ")}) ` +
    `VALUES ${rows.map(() => tuple).join(", ")}`;
  const insert = fragment(
    sql,
    rows.flatMap((row) => columns.map((name) => bindValue(table.columns[name], row[name]))),
  );
  return concat([insert, conflictClause(options)], " ");
}

export function insertFromSelectOf(
  table: TableDef,
  target: string,
  columns: readonly string[],
  source: Fragment,
  options: { conflict?: readonly string[]; update?: readonly string[] } = {},
): Fragment {
  if (columns.length === 0)
    throw new Error(`zephyr-rdb: insert into "${table.name}" has no columns`);
  const head = text(`INSERT INTO ${target} (${columns.map((name) => `"${name}"`).join(", ")})`);
  return concat([head, source, conflictClause(options)], " ");
}

// `ON CONFLICT …` 子句（没有冲突列时为空）。
export function conflictClause(options: {
  conflict?: readonly string[];
  update?: readonly string[];
}): Fragment | string {
  const conflict = options.conflict ?? [];
  if (conflict.length === 0) return "";
  const target = conflict.map((name) => `"${name}"`).join(", ");
  const updates =
    (options.update ?? []).length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET ${(options.update ?? [])
          .map((name) => `"${name}" = excluded."${name}"`)
          .join(", ")}`;
  return text(`ON CONFLICT (${target}) ${updates}`);
}

export function upsertExprOf(
  table: TableDef,
  target: string,
  row: Record<string, unknown>,
  conflict: readonly string[],
  assignments: Record<string, Operand>,
): Fragment {
  const base = insertOf(table, target, row, "insert");
  const conflictTarget = conflict.map((name) => `"${name}"`).join(", ");
  const sets = Object.entries(assignments).map(([name, ref]) =>
    concat([text(`"${name}" =`), operandSql(ref)], " "),
  );
  return concat(
    [base, text(`ON CONFLICT (${conflictTarget}) DO UPDATE SET`), concat(sets, ", ")],
    " ",
  );
}

export function updateOf(
  table: TableDef,
  target: string,
  patch: Record<string, unknown>,
  condition?: Condition,
  returning?: readonly string[],
): Fragment {
  assertKnownColumns(table, Object.keys(patch), "update");
  assertEnumValues(table, patch, "update");
  const columns = Object.keys(patch);
  if (columns.length === 0) throw new Error(`zephyr-rdb: update "${table.name}" has no columns`);
  // 值可以是表达式（列自增、取大等）：只有普通值才绑参数。
  const sets = columns.map((name) => {
    const value = patch[name];
    const assigned =
      typeof value === "object" && value !== null && "kind" in value
        ? operandSql(value as Operand)
        : param(bindValue(table.columns[name], value));
    return concat([text(`"${name}" =`), assigned], " ");
  });
  const head = concat([text(`UPDATE ${target} SET`), concat(sets, ", ")], " ");
  const body = condition === undefined ? head : concat([head, text("WHERE"), condition], " ");
  return concat([body, returningClause(table, returning)], " ");
}

export function deleteOf(
  table: TableDef,
  target: string,
  condition?: Condition,
  returning?: readonly string[],
): Fragment {
  const head = text(`DELETE FROM ${target}`);
  const body = condition === undefined ? head : concat([head, text("WHERE"), condition], " ");
  return concat([body, returningClause(table, returning)], " ");
}
