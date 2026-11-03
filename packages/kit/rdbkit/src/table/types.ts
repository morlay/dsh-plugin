import type { ColumnDef, TableDef } from "../defs.ts";
import type { ColumnRef, ExprOperand, Operand } from "../expr.ts";

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
