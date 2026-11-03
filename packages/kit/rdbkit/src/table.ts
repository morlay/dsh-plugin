import {
  and,
  columnSql,
  operandSql,
  type ColumnRef,
  type Condition,
  type ExprOperand,
  type Operand,
} from "./expr.ts";
import { concat, fragment, only, param, render, text, type Fragment } from "./fragment.ts";
import type { ColumnDef, TableDef } from "./defs.ts";
import { forUpdate as forUpdateSql, withCtes, type Cte } from "./compound.ts";
import type { Database } from "./database.ts";

/**
 * 一列对外的 TS 值类型：文本 → string、布尔 → boolean、64 位整数（`bigint`）→ JS `bigint`（精确，
 * 对应 Go 的 int64 / uint64；不能用 number，超过 `2^53` 会丢精度）、其余 → number。
 * 非 NOT NULL 允许 null。
 */
export type ColumnValue<C extends ColumnDef> = C["type"] extends "text"
  ? string
  : C["type"] extends "boolean"
    ? boolean
    : C["type"] extends "bigint"
      ? bigint
      : number;

export type RowOf<T extends TableDef> = {
  [K in keyof T["columns"]]: T["columns"][K] extends { notNull: true }
    ? ColumnValue<T["columns"][K]>
    : T["columns"][K] extends { type: "serial" }
      ? ColumnValue<T["columns"][K]>
      : ColumnValue<T["columns"][K]> | null;
};

/** 写入时 `bigint` 列也接受 number（安全整数范围内两者等价）。 */
type Writable<T> = T extends bigint ? bigint | number : T;

/**
 * 写入行：列可选（有默认值 / 自增列不必给）。值允许 number 写进 `bigint` 列，业务不必到处写 `n` 后缀；
 * 读回来仍然是 `bigint`（不丢精度）。
 */
export type InsertRow<Row> = Partial<{ [K in keyof Row]: Writable<Row[K]> }>;

/** 更新时的值：普通值（绑定参数）或表达式（`expr('"f_revision" + 1')` 等）。 */
export type UpdatePatch<Row> = { [K in keyof Row]?: Writable<Row[K]> | Operand };

/** 列名（字符串键）。 */
export type ColumnName<Row> = Extract<keyof Row, string>;

/**
 * 聚合表达式（`count()` / `sum(col)`）：投影与条件里都能用。
 *
 * 值是 64 位整数：PostgreSQL 给 `bigint`、SQLite 给 number，业务要 number 时显式 `Number(x)`。
 */
export type Aggregate<T = number | bigint> = ExprOperand<T>;

/** 投影：别名 → 列引用或聚合。结果类型由它推导。 */
export type Projection = Record<string, ColumnRef<any> | Aggregate<any>>;

/** 投影的强类型结果。 */
export type Projected<P extends Projection> = {
  [K in keyof P]: P[K] extends ColumnRef<infer T> ? T : P[K] extends Aggregate<infer T> ? T : never;
};

/** 表达式的片段：方言相关的表达式自带片段，普通的按 `sql` + 绑定参数编。 */
function exprFragment(expression: ExprOperand): Fragment {
  return expression.fragment ?? fragment(expression.sql, expression.params);
}

/** COUNT(*)，投影里写 `{ n: count() }`。 */
export function count(): Aggregate<number | bigint> {
  return { kind: "expr", sql: "COUNT(*)", params: [] };
}

/**
 * SUM(列)；多表查询时传表名避免歧义。
 *
 * PostgreSQL 的 `SUM(bigint)` 返回 `numeric`（驱动给字符串），SQLite 返回整数——统一 cast 回 int8，
 * 声明的 `number | bigint` 才成立。列类型只有 integer / bigint，所以这个 cast 不丢小数。
 */
export function sum(name: string, table?: string): Aggregate<number | bigint> {
  const target = table === undefined ? `"${name}"` : `"${table}"."${name}"`;
  return {
    kind: "expr",
    sql: "",
    params: [],
    fragment: concat(
      [
        only("sqlite", text(`SUM(${target})`)),
        only("postgres", text(`SUM(${target})::bigint`)),
      ],
      "",
    ),
  };
}

/** 一个查询：实现 `AsyncIterable`，`for await` 直接消费（对应 Golang 的 `iter.Seq2`）。 */
export interface SelectQuery<T> extends AsyncIterable<T> {
  where(condition: Condition): this;
  /** `cross` 不需要 ON；`alias` 给被 join 的表起别名（投影里用 `column(名字, 别名)`）。 */
  join(
    table: TableDef,
    on?: Condition,
    kind?: "inner" | "left" | "right" | "full" | "cross",
    alias?: string,
  ): this;
  /** `WITH "name" AS (<query>)`，多条按顺序拼。 */
  with(
    name: string,
    query: Fragment,
    options?: { recursive?: boolean; columns?: readonly string[] },
  ): this;
  /** 分组：列名（主表）、带表名的列引用或表达式。 */
  groupBy(...columns: GroupByItem[]): this;
  having(condition: Condition): this;
  distinct(): this;
  orderBy(column: string | ColumnRef | ExprOperand, direction?: "asc" | "desc"): this;
  limit(count: number): this;
  offset(count: number): this;
  /** 行锁（PostgreSQL 生效，SQLite 渲染时丢弃）。 */
  forUpdate(options?: { of?: readonly string[]; noWait?: boolean; skipLocked?: boolean }): this;
  toFragment(): Fragment;
}

/** 列访问器：`t.f_domain` 就是这一列的引用（带值类型）。 */
/** `groupBy` 的入参：列名、带表名的列引用或表达式。 */
export type GroupByItem = string | ColumnRef | ExprOperand;

export type ColumnAccessors<Row> = { readonly [K in ColumnName<Row>]: ColumnRef<Row[K]> };

/** 一张表的业务面：投影查询 + 写入，调用方不接触方言与 SQL。 */
export type TableHandle<T extends TableDef> = TableHandleBase<T> & ColumnAccessors<RowOf<T>>;

export interface TableHandleBase<T extends TableDef> {
  readonly name: string;
  readonly definition: T;
  /** 拿一列（带值类型的引用），投影 / 条件里用。 */
  column<K extends ColumnName<RowOf<T>>>(name: K): ColumnRef<RowOf<T>[K]>;
  /** 投影省略时取全部列（结果按列名原样）。 */
  select<P extends Projection = Record<string, ColumnRef>>(
    projection?: P,
  ): SelectQuery<Projected<P>>;
  /** 插入；传 `returning` 时拿回这些列（`RETURNING`，两方言都支持）。 */
  insert(
    row: InsertRow<RowOf<T>>,
    returning?: readonly ColumnName<RowOf<T>>[],
  ): Promise<RowOf<T>[]>;
  insertIgnore(row: InsertRow<RowOf<T>>, conflict: readonly ColumnName<RowOf<T>>[]): Promise<void>;
  /** `INSERT … SELECT`：把一条查询的结果按列顺序插进来（Go 的 `InsertFrom`）。 */
  insertFromSelect(
    columns: readonly ColumnName<RowOf<T>>[],
    source: Fragment,
    options?: {
      conflict?: readonly ColumnName<RowOf<T>>[];
      update?: readonly ColumnName<RowOf<T>>[];
    },
  ): Promise<void>;
  /** 批量插入；传 `conflict` / `update` 时是批量 upsert（`ON CONFLICT … DO UPDATE`）。 */
  insertMany(
    rows: readonly InsertRow<RowOf<T>>[],
    options?: {
      conflict?: readonly ColumnName<RowOf<T>>[];
      update?: readonly ColumnName<RowOf<T>>[];
    },
  ): Promise<void>;
  upsert(
    row: InsertRow<RowOf<T>>,
    conflict: readonly ColumnName<RowOf<T>>[],
    update?: readonly ColumnName<RowOf<T>>[],
  ): Promise<void>;
  update(
    patch: UpdatePatch<RowOf<T>>,
    condition?: Condition,
    returning?: readonly ColumnName<RowOf<T>>[],
  ): Promise<RowOf<T>[]>;
  /** `ON CONFLICT ... DO UPDATE SET 列 = 表达式`（如自增计数）。 */
  upsertExpr(
    row: InsertRow<RowOf<T>>,
    conflict: readonly ColumnName<RowOf<T>>[],
    assignments: Record<string, Operand>,
  ): Promise<void>;
  /** 删除；传 `returning` 时拿回被删行的这些列（`RETURNING`）。 */
  delete(condition?: Condition, returning?: readonly ColumnName<RowOf<T>>[]): Promise<RowOf<T>[]>;
}

export function createTableHandle<T extends TableDef>(
  database: Database,
  definition: T,
): TableHandle<T> {
  const name = definition.name;
  const handle: TableHandleBase<T> = {
    name,
    definition,
    column: (column) => ({ kind: "column", table: name, name: column }) as never,
    select: (projection) =>
      selectQuery(
        database,
        definition,
        projection ??
          (Object.fromEntries(
            Object.keys(definition.columns).map((name) => [
              name,
              { kind: "column", table: definition.name, name },
            ]),
          ) as Projection),
      ) as never,
    async insert(row, returning) {
      return await database.write<RowOf<T>>(
        insertOf(definition, row, "insert", undefined, undefined, returning),
      );
    },
    async insertIgnore(row, conflict) {
      await database.run(insertOf(definition, row, "ignore", conflict));
    },
    async insertFromSelect(columns, source, options) {
      await database.run(insertFromSelectOf(definition, columns, source, options));
    },
    async insertMany(rows, options) {
      await database.run(insertManyOf(definition, rows, options));
    },
    async upsert(row, conflict, update) {
      await database.run(insertOf(definition, row, "upsert", conflict, update));
    },
    async update(patch, condition, returning) {
      return await database.write<RowOf<T>>(updateOf(definition, patch, condition, returning));
    },
    async upsertExpr(row, conflict, assignments) {
      await database.run(upsertExprOf(definition, row, conflict, assignments));
    },
    async delete(condition, returning) {
      if (returning !== undefined && returning.length > 0) {
        return await database.write<RowOf<T>>(deleteOf(definition, condition, returning));
      }
      await database.run(deleteOf(definition, condition));
      return [];
    },
  };
  // 列名直接当属性读：`t.f_domain` 等价于 `t.column("f_domain")`。
  return new Proxy(handle, {
    get(target, property, receiver) {
      if (typeof property === "string" && definition.columns[property] !== undefined) {
        return { kind: "column", table: name, name: property } satisfies ColumnRef;
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as TableHandle<T>;
}

function returningClause(returning?: readonly string[]): Fragment | string {
  return returning === undefined || returning.length === 0
    ? ""
    : text(`RETURNING ${returning.map((name) => `"${name}"`).join(", ")}`);
}

function insertOf(
  table: TableDef,
  row: Record<string, unknown>,
  mode: "insert" | "ignore" | "upsert",
  conflict?: readonly string[],
  update?: readonly string[],
  returning?: readonly string[],
): Fragment {
  const columns = Object.keys(row).filter((name) => table.columns[name] !== undefined);
  if (columns.length === 0) throw new Error(`rdbkit: insert into "${table.name}" has no columns`);
  const sql =
    `INSERT INTO "${table.name}" (${columns.map((name) => `"${name}"`).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})`;
  const base = fragment(
    sql,
    columns.map((name) => row[name]),
  );
  if (mode === "insert") return concat([base, returningClause(returning)], " ");
  const target = (conflict ?? []).map((name) => `"${name}"`).join(", ");
  if (mode === "ignore") return concat([base, `ON CONFLICT (${target}) DO NOTHING`], " ");
  const updates =
    (update ?? []).length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET ${(update ?? [])
          .map((name) => `"${name}" = excluded."${name}"`)
          .join(", ")}`;
  return concat([base, `ON CONFLICT (${target}) ${updates}`, returningClause(returning)], " ");
}

function insertManyOf(
  table: TableDef,
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
    `INSERT INTO "${table.name}" (${columns.map((name) => `"${name}"`).join(", ")}) ` +
    `VALUES ${rows.map(() => tuple).join(", ")}`;
  const insert = fragment(
    sql,
    rows.flatMap((row) => columns.map((name) => row[name])),
  );
  return concat([insert, conflictClause(options)], " ");
}

function insertFromSelectOf(
  table: TableDef,
  columns: readonly string[],
  source: Fragment,
  options: { conflict?: readonly string[]; update?: readonly string[] } = {},
): Fragment {
  if (columns.length === 0) throw new Error(`rdbkit: insert into "${table.name}" has no columns`);
  const head = text(
    `INSERT INTO "${table.name}" (${columns.map((name) => `"${name}"`).join(", ")})`,
  );
  return concat([head, source, conflictClause(options)], " ");
}

/** `ON CONFLICT …` 子句（没有冲突列时为空）。 */
function conflictClause(options: {
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

function upsertExprOf(
  table: TableDef,
  row: Record<string, unknown>,
  conflict: readonly string[],
  assignments: Record<string, Operand>,
): Fragment {
  const base = insertOf(table, row, "insert");
  const target = conflict.map((name) => `"${name}"`).join(", ");
  const sets = Object.entries(assignments).map(([name, ref]) =>
    concat([text(`"${name}" =`), operandSql(ref)], " "),
  );
  return concat([base, text(`ON CONFLICT (${target}) DO UPDATE SET`), concat(sets, ", ")], " ");
}

function updateOf(
  table: TableDef,
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
  const head = concat([text(`UPDATE "${table.name}" SET`), concat(sets, ", ")], " ");
  const body = condition === undefined ? head : concat([head, text("WHERE"), condition], " ");
  return concat([body, returningClause(returning)], " ");
}

function deleteOf(table: TableDef, condition?: Condition, returning?: readonly string[]): Fragment {
  const head = text(`DELETE FROM "${table.name}"`);
  const body = condition === undefined ? head : concat([head, text("WHERE"), condition], " ");
  return concat([body, returningClause(returning)], " ");
}

function selectQuery<T>(
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

  /**
   * 结果行的值归一：`bigint` 列统一成 JS `bigint`。
   * SQLite 的 INTEGER 由驱动给 number，PostgreSQL 的 int8 已经是 BigInt（见 `bigintTypes`）——
   * 读出来的类型不能跟着驱动走，否则同一份表定义在两种方言下值类型不同。
   */
  const normalize = (row: Record<string, unknown>): T => {
    for (const [alias, entry] of Object.entries(projection)) {
      if (entry.kind !== "column") continue;
      const owner = entry.table === undefined ? table : tableOf(entry.table);
      if (owner?.columns[entry.name]?.type !== "bigint") continue;
      const value = row[alias];
      if (value === null || value === undefined || typeof value === "bigint") continue;
      row[alias] = BigInt(value as number | string);
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
      text(`FROM "${table.name}"`),
    ];
    for (const join of state.joins) {
      const target =
        join.alias === undefined
          ? `"${join.table.name}"`
          : `"${join.table.name}" AS "${join.alias}"`;
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
    if (state.limit !== undefined) parts.push(fragment("LIMIT ?", [state.limit]));
    if (state.offset !== undefined) parts.push(fragment("OFFSET ?", [state.offset]));
    if (state.lock !== undefined) parts.push(state.lock);
    return withCtes(state.ctes, concat(parts, " "));
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
      state.limit = count;
      return query;
    },
    offset(count) {
      state.offset = count;
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

export { columnSql, render };
