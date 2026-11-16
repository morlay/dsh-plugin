import type { TableDef } from "../defs.ts";
import { assertSupported } from "../dialect.ts";
import { concat, fragment, only, readBigInts, text, type Fragment } from "../fragment.ts";
import { and, columnSql, type ColumnRef, type Condition, type ExprOperand } from "../expr.ts";
import { forUpdate as forUpdateSql, withCtes, type Cte } from "../compound.ts";
import type { Database } from "../database/types.ts";
import type { Aggregate, Projection } from "./types.ts";
import { normalizeValue } from "./normalize.ts";

// 表达式的片段：方言相关的表达式自带片段，普通的按 `sql` + 绑定参数编。
function exprFragment(expression: ExprOperand): Fragment {
  return expression.fragment ?? fragment(expression.sql, expression.params);
}

// COUNT(*)，投影里写 `{ n: count() }`。
export function count(): Aggregate<number | bigint> {
  return { kind: "expr", sql: "COUNT(*)", params: [] };
}

// SUM(列)；多表查询时传表名避免歧义。
//
// PostgreSQL 的 `SUM(bigint)` 返回 `numeric`（驱动给字符串），SQLite 返回整数——统一 cast 回 int8，
// 声明的 `number | bigint` 才成立。列类型只有 integer / bigint，所以这个 cast 不丢小数。
export function sum(name: string, table?: string): Aggregate<number | bigint> {
  const target = table === undefined ? `"${name}"` : `"${table}"."${name}"`;
  return {
    kind: "expr",
    sql: "",
    params: [],
    fragment: concat(
      [only("sqlite", text(`SUM(${target})`)), only("postgres", text(`SUM(${target})::bigint`))],
      "",
    ),
  };
}

// 一个查询：实现 `AsyncIterable`，`for await` 直接消费（对应 Golang 的 `iter.Seq2`）。
export interface SelectQuery<T> extends AsyncIterable<T> {
  where(condition: Condition): this;
  // `cross` 不需要 ON；`alias` 给被 join 的表起别名（投影里用 `column(名字, 别名)`）。
  join(
    table: TableDef,
    on?: Condition,
    kind?: "inner" | "left" | "right" | "full" | "cross",
    alias?: string,
  ): this;
  // `WITH "name" AS (<query>)`，多条按顺序拼。
  with(
    name: string,
    query: Fragment,
    options?: { recursive?: boolean; columns?: readonly string[] },
  ): this;
  // 分组：列名（主表）、带表名的列引用或表达式。
  groupBy(...columns: GroupByItem[]): this;
  having(condition: Condition): this;
  distinct(): this;
  orderBy(column: string | ColumnRef | ExprOperand, direction?: "asc" | "desc"): this;
  limit(count: number): this;
  offset(count: number): this;
  // 行锁（PostgreSQL 生效，SQLite 渲染时丢弃）。
  forUpdate(options?: { of?: readonly string[]; noWait?: boolean; skipLocked?: boolean }): this;
  toFragment(): Fragment;
}

// `groupBy` 的入参：列名、带表名的列引用或表达式。
export type GroupByItem = string | ColumnRef | ExprOperand;

// 分页参数只能是自然数：负数在 SQLite 上是「无限制」、NaN 会被驱动当成坏绑定值，两者都静默出错。
function assertCount(kind: "limit" | "offset", value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "zephyr-rdb: " + kind + " must be a non-negative safe integer, got " + String(value),
    );
  }
  return value;
}

export function selectQuery<T>(
  database: Database,
  table: TableDef,
  projection: Projection,
): SelectQuery<T> {
  const state: {
    condition?: Condition | undefined;
    joins: {
      table: TableDef;
      on?: Condition | undefined;
      kind: "inner" | "left" | "right" | "full" | "cross";
      alias?: string | undefined;
    }[];
    ctes: Cte[];
    lock?: Fragment | undefined;
    having?: Condition | undefined;
    distinct: boolean;
    order: { column: string | ColumnRef | ExprOperand; direction: "asc" | "desc" }[];
    group: GroupByItem[];
    limit?: number | undefined;
    offset?: number | undefined;
  } = { joins: [], ctes: [], distinct: false, order: [], group: [] };

  // 结果行的值归一：`bigint` 与 `boolean` 统一成声明给调用方的 JS 类型。
  // SQLite 的 INTEGER 由驱动给 number（BOOLEAN 也一样给 0/1），PostgreSQL 的 int8 已经是 BigInt、
  // BOOLEAN 已经是 true/false——读出来的类型不能跟着驱动走，否则同一份表定义在两种方言下值类型不同。
  const normalize = (row: Record<string, unknown>): T => {
    for (const [alias, entry] of Object.entries(projection)) {
      if (entry.kind !== "column") continue;
      const owner = entry.table === undefined ? table : tableOf(entry.table);
      row[alias] = normalizeValue(owner?.columns[entry.name], row[alias]);
    }
    return row as T;
  };

  const tableOf = (name: string): TableDef | undefined => {
    if (name === table.name) return table;
    for (const join of state.joins) {
      if ((join.alias ?? join.table.name) === name) return join.table;
    }
    return undefined;
  };

  // 投影里的列是不是 bigint：决定整条语句要不要按 BigInt 读（SQLite 的开关是语句级）。
  const isBigintColumn = (alias: string): boolean => {
    const entry = projection[alias];
    if (entry === undefined || entry.kind !== "column") return false;
    const owner = entry.table === undefined ? table : tableOf(entry.table);
    return owner?.columns[entry.name]?.type === "bigint";
  };

  // 表引用按连接的方言算（PostgreSQL 带 schema）：FROM / JOIN 与其余引用保持同一处。
  const targetOf = (definition: TableDef): string =>
    database.dialect.tableName(definition.name, database.schema);
  const toFragment = (): Fragment => {
    const items = Object.entries(projection).map(([alias, entry]) =>
      entry.kind === "column"
        ? text(
            `${entry.table === undefined ? "" : `"${entry.table}".`}"${entry.name}" AS "${alias}"`,
          )
        : concat([exprFragment(entry), text(`AS "${alias}"`)], " "),
    );
    const parts: (Fragment | string)[] = [
      state.distinct ? text("SELECT DISTINCT") : text("SELECT"),
      concat(items, ", "),
      text(`FROM ${targetOf(table)}`),
    ];
    for (const join of state.joins) {
      const target =
        join.alias === undefined
          ? targetOf(join.table)
          : `${targetOf(join.table)} AS "${join.alias}"`;
      if (join.kind === "cross") {
        parts.push(text(`CROSS JOIN ${target}`));
        continue;
      }
      const keyword = join.kind === "inner" ? "JOIN" : `${join.kind.toUpperCase()} JOIN`;
      parts.push(text(`${keyword} ${target} ON`), join.on ?? text("1 = 1"));
    }
    if (state.condition !== undefined) parts.push(text("WHERE"), state.condition);
    if (state.group.length > 0) {
      const groupParts = state.group.map((item) =>
        typeof item === "string"
          ? text(`"${table.name}"."${item}"`)
          : item.kind === "column"
            ? text(columnSql(item))
            : exprFragment(item),
      );
      parts.push(text("GROUP BY"), concat(groupParts, ", "));
    }
    if (state.having !== undefined) parts.push(text("HAVING"), state.having);
    if (state.order.length > 0) {
      const orderParts = state.order.map((order) => {
        const ref =
          typeof order.column === "string"
            ? text(`"${table.name}"."${order.column}"`)
            : order.column.kind === "column"
              ? text(columnSql(order.column))
              : exprFragment(order.column);
        return concat([ref, text(order.direction.toUpperCase())], " ");
      });
      parts.push(text("ORDER BY"), concat(orderParts, ", "));
    }
    // SQLite 不认「只有 OFFSET」的写法（near "OFFSET": syntax error），PG 认；SQLite 侧补一个无上限 LIMIT。
    if (state.offset !== undefined && state.limit === undefined) {
      parts.push(only("sqlite", text("LIMIT -1")));
    }
    if (state.limit !== undefined) parts.push(fragment("LIMIT ?", [state.limit]));
    if (state.offset !== undefined) parts.push(fragment("OFFSET ?", [state.offset]));
    if (state.lock !== undefined) parts.push(state.lock);
    const statement = withCtes(state.ctes, concat(parts, " "));
    // 投影里有 bigint 列时整条语句按 BigInt 读；其它 INTEGER 列（integer / boolean）由归一还原。
    return Object.keys(projection).some(isBigintColumn) ? readBigInts(statement) : statement;
  };

  const query: SelectQuery<T> = {
    where(condition) {
      state.condition = state.condition === undefined ? condition : and(state.condition, condition);
      return query;
    },
    join(joined, on, kind = "inner", alias) {
      state.joins.push({ table: joined, on, kind, alias });
      return query;
    },
    with(name, queryText, options = {}) {
      state.ctes.push({ name, query: queryText, ...options });
      return query;
    },
    forUpdate(options) {
      // SQLite 没有行锁：缺能力立刻抛 `unsupported`，不静默丢弃。
      assertSupported(database.dialect, "row-lock", "FOR UPDATE");
      state.lock = forUpdateSql(options);
      return query;
    },
    groupBy(...columns) {
      state.group.push(...columns);
      return query;
    },
    having(condition) {
      state.having = condition;
      return query;
    },
    distinct() {
      state.distinct = true;
      return query;
    },
    orderBy(column, direction = "asc") {
      state.order.push({ column, direction });
      return query;
    },
    limit(count) {
      state.limit = assertCount("limit", count);
      return query;
    },
    offset(count) {
      state.offset = assertCount("offset", count);
      return query;
    },
    toFragment,
    async *[Symbol.asyncIterator]() {
      for await (const row of database.iterate<Record<string, unknown>>(toFragment())) {
        yield normalize(row);
      }
    },
  };
  return query;
}
