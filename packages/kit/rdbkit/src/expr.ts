import { concat, fragment, only, param, text, type Fragment } from "./fragment.ts";

/** 列引用：查询构建器统一用双引号（两种方言都认）；`__value` 只做类型携带。 */
export interface ColumnRef<T = unknown> {
  readonly kind: "column";
  readonly table?: string;
  readonly name: string;
  readonly __value?: T;
}

/** 字面参数（值走绑定，不拼字符串）。 */
export interface Value {
  readonly kind: "value";
  readonly value: unknown;
}

/** 表达式操作数（聚合、函数调用这类不是列也不是字面量值的东西）。 */
export interface ExprOperand<T = unknown> {
  readonly kind: "expr";
  readonly sql: string;
  readonly params: readonly unknown[];
  /** 方言相关的表达式（JSON 提取、本地日这类）用片段表达；给了它就不用 `sql` / `params`。 */
  readonly fragment?: Fragment;
  readonly __value?: T;
}

/** 列、值或表达式。 */
export type Operand = ColumnRef | Value | ExprOperand;

/** 条件里可以直接写原始值（自动包成绑定参数）；`null` 走 IS NULL / IS NOT NULL。 */
export type OperandInput = Operand | string | number | boolean | bigint | null;

/** 一个条件（可再组合的片段）。 */
export type Condition = Fragment;

export function column<T = unknown>(name: string, table?: string): ColumnRef<T> {
  return { kind: "column", name, ...(table === undefined ? {} : { table }) };
}

export function value(input: unknown): Value {
  return { kind: "value", value: input };
}

/** 列名引用成 SQL：`"表"."列"` 或 `"列"`。 */
export function columnSql(ref: ColumnRef): string {
  const name = `"${ref.name}"`;
  return ref.table === undefined ? name : `"${ref.table}".${name}`;
}

/** 把操作数渲染成片段（投影 / 赋值里复用）。 */
export function operandSql(ref: Operand): Fragment {
  return operand(ref);
}

/** 表达式操作数的便捷构造（如 `expr('"f_count" + 1')`）。 */
export function expr(sql: string, params: readonly unknown[] = []): ExprOperand {
  return { kind: "expr", sql, params };
}

function asOperand(input: OperandInput): Operand {
  if (typeof input === "object" && input !== null && "kind" in input) return input;
  return value(input);
}

function operand(ref: Operand): Fragment {
  if (ref.kind === "column") return text(columnSql(ref));
  if (ref.kind === "value") return param(ref.value);
  return ref.fragment ?? fragment(ref.sql, ref.params);
}

/** 两个方言各给一份片段，由 rdbkit 在渲染时挑本方言的那份。 */
function dialectExpr<T>(sqlite: Fragment, postgres: Fragment): ExprOperand<T> {
  return {
    kind: "expr",
    sql: "",
    params: [],
    fragment: concat([only("sqlite", sqlite), only("postgres", postgres)], ""),
  };
}

/** 输入转成片段（列 / 值 / 表达式都认）。 */
function fragmentOf(input: OperandInput): Fragment {
  return operand(asOperand(input));
}

function binary(left: OperandInput, operator: string, right: OperandInput): Condition {
  if (right === null)
    return concat([operand(asOperand(left)), text(`${operator === "=" ? "IS" : "IS NOT"} NULL`)]);
  return concat([operand(asOperand(left)), text(operator), operand(asOperand(right))]);
}

export const eq = (left: OperandInput, right: OperandInput): Condition => binary(left, "=", right);
export const ne = (left: OperandInput, right: OperandInput): Condition => binary(left, "<>", right);
export const gt = (left: OperandInput, right: OperandInput): Condition => binary(left, ">", right);
export const gte = (left: OperandInput, right: OperandInput): Condition =>
  binary(left, ">=", right);
export const lt = (left: OperandInput, right: OperandInput): Condition => binary(left, "<", right);
export const lte = (left: OperandInput, right: OperandInput): Condition =>
  binary(left, "<=", right);
export const like = (left: OperandInput, right: OperandInput): Condition =>
  binary(left, "LIKE", right);

/** `BETWEEN ? AND ?`。 */
export const between = (ref: OperandInput, low: OperandInput, high: OperandInput): Condition =>
  concat([
    operand(asOperand(ref)),
    text("BETWEEN"),
    operand(asOperand(low)),
    text("AND"),
    operand(asOperand(high)),
  ]);

/** `列 IN (子查询)`。 */
export function inSubquery(ref: Operand, subquery: Fragment): Condition {
  return concat([operand(asOperand(ref)), text("IN ("), subquery, text(")")]);
}

/** `列 NOT IN (子查询)`。 */
export function notInSubquery(ref: OperandInput, subquery: Fragment): Condition {
  return concat([operand(asOperand(ref)), text("NOT IN ("), subquery, text(")")]);
}

/** 恒真条件（占位用，避免业务侧写 `raw("1 = 1")`）。 */
export function always(): Condition {
  return raw("1 = 1");
}

/** 恒假条件。 */
export function never(): Condition {
  return raw("1 = 0");
}

/** 函数式表达式：`名字(<参数>)`（值走绑定，参数可以是列 / 值 / 别的表达式）。 */
function call(name: string, inputs: readonly OperandInput[]): ExprOperand {
  return {
    kind: "expr",
    sql: "",
    params: [],
    fragment: concat(
      [
        text(`${name}(`),
        concat(
          inputs.map((input) => operand(asOperand(input))),
          ", ",
        ),
        text(")"),
      ],
      "",
    ),
  };
}

/** `COALESCE(a, b, …)`：值走绑定参数，列/表达式原样渲染。 */
export function coalesce(...inputs: OperandInput[]): ExprOperand {
  return call("COALESCE", inputs);
}

/** `lower(x)`（表达式位置用）。 */
export function lower(input: OperandInput): ExprOperand {
  return call("lower", [input]);
}

/** `x IS NOT NULL` 的表达式形式（投影 / 分组位置用）。 */
export function notNull(input: OperandInput): ExprOperand {
  return {
    kind: "expr",
    sql: "",
    params: [],
    fragment: concat([operand(asOperand(input)), text("IS NOT NULL")]),
  };
}

/** `a IS DISTINCT FROM b`（NULL 也参与比较，不会退化成 `IS NULL`）。 */
export function isDistinctFrom(left: OperandInput, right: OperandInput): Condition {
  return concat([operand(asOperand(left)), text("IS DISTINCT FROM"), operand(asOperand(right))]);
}

/** `EXISTS (子查询)`。 */
export function exists(subquery: Fragment): Condition {
  return concat([text("EXISTS ("), subquery, text(")")]);
}

/** `NOT (...)`。 */
export const not = (condition: Condition): Condition =>
  concat([text("NOT ("), condition, text(")")]);

/**
 * 显式逃生口：少数表达不了的片段（窗口函数、方言专属函数）才用它。
 * 占位符仍只由 `?` + 参数生成，避免把值拼进文本。
 */
export function raw(sql: string, params: readonly unknown[] = []): Condition {
  return fragment(sql, params);
}

/** `a + b`（列自增、upsert 累加）。 */
export function add(left: OperandInput, right: OperandInput): ExprOperand<number> {
  return { kind: "expr", sql: "", params: [], fragment: concat([fragmentOf(left), text("+"), fragmentOf(right)]) };
}

/** upsert 冲突时的「新值」引用：`excluded."列"`（只用于 `upsertExpr` 的赋值）。 */
export function excluded(name: string): ExprOperand {
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) throw new Error(`rdbkit: invalid column '${name}'`);
  return { kind: "expr", sql: "", params: [], fragment: text(`excluded."${name}"`) };
}

/** 条件渲染成整数列的值（`CASE WHEN cond THEN 1 ELSE 0 END`，两方言同一份）。 */
export function toInt(condition: Condition): ExprOperand<number> {
  return {
    kind: "expr",
    sql: "",
    params: [],
    fragment: concat([text("CASE WHEN"), condition, text("THEN 1 ELSE 0 END")]),
  };
}

/** 条件计数：`SUM(CASE WHEN cond THEN 1 ELSE 0 END)`（投影 / 分组位置用）。 */
export function countIf(condition: Condition): ExprOperand<number> {
  return {
    kind: "expr",
    sql: "",
    params: [],
    fragment: concat([text("SUM("), operand(toInt(condition)), text(")")], ""),
  };
}

/** 只增不减：`max(a, b)` 的方言无关写法（NULL 视作 0，两方言同一份 CASE）。 */
export function maxOf(first: OperandInput, ...rest: readonly OperandInput[]): ExprOperand<number> {
  let current = fragmentOf(first);
  for (const next of rest) {
    const coalesced = concat([text("COALESCE("), current, text(", 0)")], "");
    current = concat([
      text("CASE WHEN"),
      coalesced,
      text("<"),
      fragmentOf(next),
      text("THEN"),
      fragmentOf(next),
      text("ELSE"),
      coalesced,
      text("END"),
    ]);
  }
  return { kind: "expr", sql: "", params: [], fragment: current };
}

/** JSON 路径（`$.a.b`）→ 段列表；段只允许标识符字符（PG 侧要内联进 `#>>` 的数组字面量）。 */
function jsonPathParts(path: string): string[] {
  if (!path.startsWith("$.") || path.length < 3) {
    throw new Error(`rdbkit: JSON path must look like '$.a.b', got '${path}'`);
  }
  const parts = path.slice(2).split(".");
  for (const part of parts) {
    if (!/^[A-Za-z0-9_]+$/u.test(part)) {
      throw new Error(`rdbkit: unsupported JSON path segment '${part}' in '${path}'`);
    }
  }
  return parts;
}

/** JSON 文本提取：SQLite `json_extract(列, 路径)`、PostgreSQL `列::json #>> '{a,b}'`。 */
export function jsonText(input: OperandInput, path: string): ExprOperand<string | null> {
  const parts = jsonPathParts(path);
  return dialectExpr<string | null>(
    concat([text("json_extract("), fragmentOf(input), text(", "), param(path), text(")")], ""),
    concat([fragmentOf(input), text("::json #>> "), text(`'{${parts.join(",")}}'`)], ""),
  );
}

/** JSON 整数提取：文本提取后再转整数（SQLite 的 `json_extract` 本身就按类型给值）。 */
export function jsonInt(input: OperandInput, path: string): ExprOperand<number | null> {
  const parts = jsonPathParts(path);
  return dialectExpr<number | null>(
    concat([text("json_extract("), fragmentOf(input), text(", "), param(path), text(")")], ""),
    concat(
      [
        text("("),
        fragmentOf(input),
        text("::json #>> "),
        text(`'{${parts.join(",")}}'`),
        text(")::integer"),
      ],
      "",
    ),
  );
}

/**
 * 毫秒时间戳 → 本地日（`YYYY-MM-DD`）。
 *
 * 按**数据库所在机器的本地时区**算（SQLite `localtime` / PG 会话时区），两方言口径一致。
 */
export function localDay(input: OperandInput): ExprOperand<string> {
  return dialectExpr<string>(
    concat(
      [text("date("), fragmentOf(input), text(" / 1000, 'unixepoch', 'localtime')")],
      "",
    ),
    concat(
      [text("to_char(to_timestamp("), fragmentOf(input), text(" / 1000.0), 'YYYY-MM-DD')")],
      "",
    ),
  );
}

export const isNull = (ref: Operand): Condition => concat([operand(ref), text("IS NULL")]);
export const isNotNull = (ref: Operand): Condition => concat([operand(ref), text("IS NOT NULL")]);

/** `IN (?, ?, …)`；空列表渲染成恒假（`1 = 0`），避免拼出 `IN ()`。 */
export function inList(left: OperandInput, values: readonly unknown[]): Condition {
  if (values.length === 0) return fragment("1 = 0");
  return concat([
    operand(asOperand(left)),
    fragment(`IN (${values.map(() => "?").join(", ")})`, values),
  ]);
}

/** `NOT IN (...)`；空列表恒真。 */
export function notInList(left: OperandInput, values: readonly unknown[]): Condition {
  if (values.length === 0) return fragment("1 = 1");
  return concat([
    operand(asOperand(left)),
    fragment(`NOT IN (${values.map(() => "?").join(", ")})`, values),
  ]);
}

function isEmpty(value: Fragment): boolean {
  for (const part of value()) {
    void part;
    return false;
  }
  return true;
}

function combine(keyword: "AND" | "OR", conditions: readonly Condition[]): Condition {
  const parts = conditions.filter((condition) => !isEmpty(condition));
  if (parts.length === 0) return fragment(keyword === "AND" ? "1 = 1" : "1 = 0");
  if (parts.length === 1) return parts[0]!;
  // 多个条件一律加括号：`a AND b OR c` 的优先级容易在组合时出错。
  const flat = parts.flatMap((condition, index) =>
    index === 0 ? [condition] : [text(` ${keyword} `), condition],
  );
  return concat([text("("), ...flat, text(")")], "");
}

export const and = (...conditions: readonly Condition[]): Condition => combine("AND", conditions);
export const or = (...conditions: readonly Condition[]): Condition => combine("OR", conditions);
