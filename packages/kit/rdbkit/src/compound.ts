import { concat, text, type Fragment } from "./fragment.ts";
import type { TableDef } from "./defs.ts";

/** 一条 CTE：`"name" AS (<query>)`；`recursive` 时由 `withCtes` 渲染成 `WITH RECURSIVE` 前缀。 */
export interface Cte {
  readonly name: string;
  readonly query: Fragment;
  readonly recursive?: boolean;
  readonly columns?: readonly string[];
}

/** 把一条 CTE 拼在 `WITH` 之后（调用方负责逗号）。 */
export function cteSql(cte: Cte): Fragment {
  const columns =
    cte.columns === undefined ? "" : ` (${cte.columns.map((name) => `"${name}"`).join(", ")})`;
  return concat([text(`"${cte.name}"${columns} AS (`), cte.query, text(")")], " ");
}

/** 组装 `WITH [RECURSIVE] cte, … SELECT …`。 */
export function withCtes(ctes: readonly Cte[], query: Fragment): Fragment {
  if (ctes.length === 0) return query;
  const recursive = ctes.some((cte) => cte.recursive === true);
  return concat(
    [text(recursive ? "WITH RECURSIVE" : "WITH"), concat(ctes.map(cteSql), ", "), query],
    " ",
  );
}

/** `UNION` / `UNION ALL`。 */
export function union(left: Fragment, right: Fragment, options: { all?: boolean } = {}): Fragment {
  return concat([left, text(options.all === true ? "UNION ALL" : "UNION"), right], " ");
}

/** `INTERSECT`。 */
export function intersect(left: Fragment, right: Fragment): Fragment {
  return concat([left, text("INTERSECT"), right], " ");
}

/** `EXCEPT`。 */
export function except(left: Fragment, right: Fragment): Fragment {
  return concat([left, text("EXCEPT"), right], " ");
}

/** 行锁：只有 PostgreSQL 认，SQLite 渲染时整段丢掉（分隔符也不能漏出来）。 */
export function forUpdate(
  options: {
    of?: readonly string[];
    noWait?: boolean;
    skipLocked?: boolean;
  } = {},
): Fragment {
  const parts = ["FOR UPDATE"];
  if (options.of !== undefined && options.of.length > 0) {
    parts.push(`OF ${options.of.map((name) => `"${name}"`).join(", ")}`);
  }
  if (options.noWait === true) parts.push("NOWAIT");
  if (options.skipLocked === true) parts.push("SKIP LOCKED");
  return text(parts.join(" "), { only: "postgres" });
}

/** 表别名（join / CTE 里用）。 */
export function aliasedTable(table: TableDef, alias: string): string {
  return `"${table.name}" AS "${alias}"`;
}
