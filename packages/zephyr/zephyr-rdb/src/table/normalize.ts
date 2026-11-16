import type { ColumnDef, TableDef } from "../defs.ts";

// 一列读回来的值归一：声明给调用方的 `ColumnValue` 只有一种答案，所以所有读路径
// （投影查询、`RETURNING`）都过这里——同一个 home，同一个结果。
//
// SQLite 打开语句级 BigInt 读取后，同一语句里的 INTEGER 列也回 `bigint`：`integer` / `serial`
// 列在这里退回 `number`，等于「只有 bigint 列是 BigInt」，类型不会从一列扩散到整行。
export function normalizeValue(column: ColumnDef | undefined, value: unknown): unknown {
  if (column === undefined || value === null || value === undefined) return value;
  switch (column.type) {
    case "bigint":
      return typeof value === "bigint" ? value : BigInt(value as number | string);
    case "boolean":
      if (typeof value === "bigint") return value !== 0n;
      return typeof value === "number" ? value !== 0 : value;
    case "integer":
    case "serial":
      return typeof value === "bigint" ? Number(value) : value;
    case "json":
      // SQLite 存 TEXT（驱动给字符串）；PostgreSQL 的 JSONB 由驱动直接解析成对象。
      return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    default:
      return value;
  }
}

/** 写入语句拿回来的行（`RETURNING`）：与投影查询给同一套值类型。 */
export function normalizeReturning<T>(
  table: TableDef,
  columns: readonly string[] | undefined,
  rows: T[],
): T[] {
  if (columns === undefined || columns.length === 0) return rows;
  for (const row of rows as Record<string, unknown>[]) {
    for (const name of columns) row[name] = normalizeValue(table.columns[name], row[name]);
  }
  return rows;
}
