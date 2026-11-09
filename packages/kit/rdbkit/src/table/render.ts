import type { TableDef } from "../defs.ts";
import { concat, fragment, param, text, type Fragment } from "../fragment.ts";
import { operandSql, type Condition, type Operand } from "../expr.ts";

export function returningClause(returning?: readonly string[]): Fragment | string {
  return returning === undefined || returning.length === 0
    ? ""
    : text(`RETURNING ${returning.map((name) => `"${name}"`).join(", ")}`);
}

export function insertOf(
  table: TableDef,
  target: string,
  row: Record<string, unknown>,
  mode: "insert" | "ignore" | "upsert",
  conflict?: readonly string[],
  update?: readonly string[],
  returning?: readonly string[],
): Fragment {
  const columns = Object.keys(row).filter((name) => table.columns[name] !== undefined);
  if (columns.length === 0) throw new Error(`rdbkit: insert into "${table.name}" has no columns`);
  const sql =
    `INSERT INTO ${target} (${columns.map((name) => `"${name}"`).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})`;
  const base = fragment(
    sql,
    columns.map((name) => row[name]),
  );
  if (mode === "insert") return concat([base, returningClause(returning)], " ");
  const conflictTarget = (conflict ?? []).map((name) => `"${name}"`).join(", ");
  if (mode === "ignore") return concat([base, `ON CONFLICT (${conflictTarget}) DO NOTHING`], " ");
  const updates =
    (update ?? []).length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET ${(update ?? [])
          .map((name) => `"${name}" = excluded."${name}"`)
          .join(", ")}`;
  return concat(
    [base, `ON CONFLICT (${conflictTarget}) ${updates}`, returningClause(returning)],
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
  const columns = Object.keys(rows[0]!).filter((name) => table.columns[name] !== undefined);
  if (columns.length === 0) throw new Error(`rdbkit: insert into "${table.name}" has no columns`);
  for (const row of rows) {
    for (const column of columns) {
      if (row[column] === undefined) {
        throw new Error(`rdbkit: insertMany into "${table.name}" is missing column '${column}'`);
      }
    }
  }
  const tuple = `(${columns.map(() => "?").join(", ")})`;
  const sql =
    `INSERT INTO ${target} (${columns.map((name) => `"${name}"`).join(", ")}) ` +
    `VALUES ${rows.map(() => tuple).join(", ")}`;
  const insert = fragment(
    sql,
    rows.flatMap((row) => columns.map((name) => row[name])),
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
  if (columns.length === 0) throw new Error(`rdbkit: insert into "${table.name}" has no columns`);
  const head = text(`INSERT INTO ${target} (${columns.map((name) => `"${name}"`).join(", ")})`);
  return concat([head, source, conflictClause(options)], " ");
}

/** `ON CONFLICT …` 子句（没有冲突列时为空）。 */
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
  const columns = Object.keys(patch).filter((name) => table.columns[name] !== undefined);
  if (columns.length === 0) throw new Error(`rdbkit: update "${table.name}" has no columns`);
  // 值可以是表达式（列自增、取大等）：只有普通值才绑参数。
  const sets = columns.map((name) => {
    const value = patch[name];
    const assigned =
      typeof value === "object" && value !== null && "kind" in value
        ? operandSql(value as Operand)
        : param(value);
    return concat([text(`"${name}" =`), assigned], " ");
  });
  const head = concat([text(`UPDATE ${target} SET`), concat(sets, ", ")], " ");
  const body = condition === undefined ? head : concat([head, text("WHERE"), condition], " ");
  return concat([body, returningClause(returning)], " ");
}

export function deleteOf(
  table: TableDef,
  target: string,
  condition?: Condition,
  returning?: readonly string[],
): Fragment {
  const head = text(`DELETE FROM ${target}`);
  const body = condition === undefined ? head : concat([head, text("WHERE"), condition], " ");
  return concat([body, returningClause(returning)], " ");
}
