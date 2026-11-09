import type { TableDef } from "../defs.ts";
import type { ColumnRef, Condition, Operand } from "../expr.ts";
import type { Fragment } from "../fragment.ts";
import type { Database } from "../database/types.ts";
import {
  type ColumnName,
  type InsertRow,
  type Projected,
  type Projection,
  type RowOf,
  type UpdatePatch,
} from "./types.ts";
import { selectQuery, type SelectQuery } from "./select.ts";
import {
  deleteOf,
  insertFromSelectOf,
  insertManyOf,
  insertOf,
  updateOf,
  upsertExprOf,
} from "./render.ts";

/** 列访问器：`t.f_domain` 就是这一列的引用（带值类型）。 */
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
  // 目标表名按连接的方言算一次（PostgreSQL 带 schema，SQLite 就是表名）。
  const target = database.dialect.tableName(name, database.schema);
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
        insertOf(definition, target, row, "insert", undefined, undefined, returning),
      );
    },
    async insertIgnore(row, conflict) {
      await database.run(insertOf(definition, target, row, "ignore", conflict));
    },
    async insertFromSelect(columns, source, options) {
      await database.run(insertFromSelectOf(definition, target, columns, source, options));
    },
    async insertMany(rows, options) {
      await database.run(insertManyOf(definition, target, rows, options));
    },
    async upsert(row, conflict, update) {
      await database.run(insertOf(definition, target, row, "upsert", conflict, update));
    },
    async update(patch, condition, returning) {
      return await database.write<RowOf<T>>(
        updateOf(definition, target, patch, condition, returning),
      );
    },
    async upsertExpr(row, conflict, assignments) {
      await database.run(upsertExprOf(definition, target, row, conflict, assignments));
    },
    async delete(condition, returning) {
      if (returning !== undefined && returning.length > 0) {
        return await database.write<RowOf<T>>(deleteOf(definition, target, condition, returning));
      }
      await database.run(deleteOf(definition, target, condition));
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
