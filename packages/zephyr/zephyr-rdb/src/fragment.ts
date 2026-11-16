import type { DialectName } from "./dialect.ts";

// 片段里的一步：要么是一段 SQL 文本，要么是一个绑定参数。
// 参数不在片段里决定占位符——渲染时按方言给 `?` 或 `$n`。
//
// `readBigInts` 是给执行层的提示：这条语句要按 BigInt 读整数列（SQLite 的开关是语句级）。
// 它跟着片段走，所以「哪些列是 bigint」由渲染语句的那一侧（表句柄）决定，执行层只照做。
export type FragPart =
  | { readonly text: string; readonly only?: DialectName; readonly readBigInts?: true }
  | { readonly param: unknown; readonly only?: DialectName; readonly readBigInts?: true };

// SQL 片段是**惰性的迭代器**（与 Golang `sqlfrag` 的 `iter.Seq2[string, []any]` 对齐）：
// 组合时不拼字符串，只有渲染 / 执行时才逐段展开。可重复消费（每次调用重新生成）。
export type Fragment = () => Iterable<FragPart>;

// 一段纯文本；`only` 限定只在某个方言里出现（SQLite 不支持的行锁等）。
export function text(value: string, options: { only?: DialectName } = {}): Fragment {
  return () =>
    value === ""
      ? []
      : [{ text: value, ...(options.only === undefined ? {} : { only: options.only }) }];
}

// 一个绑定参数。
export function param(value: unknown): Fragment {
  return () => [{ param: value }];
}

// 把 `?` 占位符与参数列表编成片段（便捷构造；我们生成的 SQL 只含占位符，不含字面量 `?`）。
export function fragment(sql: string, params: readonly unknown[] = []): Fragment {
  return () => {
    const chunks = sql.split("?");
    const placeholders = chunks.length - 1;
    // 数与参不一致时立刻失败：少给一个参数会让 PostgreSQL 的 $n 出现空洞，多给一个被静默丢弃，
    // 两种都不会报错，只会在运行期把值绑到别的占位符上（raw 是唯一的逃生口，最容易踩这条）。
    if (placeholders !== params.length) {
      throw new Error(
        "zephyr-rdb: fragment has " +
          String(placeholders) +
          " '?' placeholder(s) but " +
          String(params.length) +
          " param(s): " +
          sql,
      );
    }
    const parts: FragPart[] = [];
    for (const [index, chunk] of chunks.entries()) {
      if (chunk !== "") parts.push({ text: chunk });
      if (index < params.length) parts.push({ param: params[index] });
    }
    return parts;
  };
}

// 按顺序拼接（`separator` 只在两个非空片段之间插入，片段内部的各步不拆开）。
export function concat(fragments: readonly (Fragment | string)[], separator = " "): Fragment {
  return () => {
    function* generate(): Generator<FragPart> {
      let first = true;
      for (const entry of fragments) {
        const item = typeof entry === "string" ? text(entry) : entry;
        let opened = false;
        for (const part of item()) {
          if (!opened) {
            if (!first && separator !== "") yield { text: separator };
            first = false;
            opened = true;
          }
          yield part;
        }
      }
    }
    return generate();
  };
}

// 把整段限定在某个方言里：每个片段步都带上 `only`，渲染时别的方言整段丢弃
// （连同它的绑定参数——方言相关表达式靠这一条做到「只留本方言的占位符」）。
export function only(dialect: DialectName, source: Fragment): Fragment {
  return () => {
    const parts: FragPart[] = [];
    for (const part of source()) parts.push({ ...part, only: part.only ?? dialect });
    return parts;
  };
}

// 标记整段语句要按 BigInt 读整数列：SQLite 的 `setReadBigInts` 是语句级开关，
// 只能整条语句打开；打开后 INTEGER 列也回 BigInt，由 `table/normalize.ts` 按列定义退回 number。
// PostgreSQL 的 int8 在连接上已经是 BigInt，这个标记对它无副作用。
export function readBigInts(source: Fragment): Fragment {
  return () => {
    const parts: FragPart[] = [];
    for (const part of source()) parts.push({ ...part, readBigInts: true });
    return parts;
  };
}

// 渲染成某方言的 SQL：SQLite 保持 `?`，PostgreSQL 用 `$1..$n`。
// 同时把片段级的执行提示汇总出来（任一有效步标记了 BigInt 读取，整条语句就打开）。
export function render(
  fragment: Fragment,
  dialect: DialectName,
): { text: string; params: unknown[]; readBigInts: boolean } {
  const params: unknown[] = [];
  let sql = "";
  let readBigInts = false;
  for (const part of fragment()) {
    if (part.only !== undefined && part.only !== dialect) continue;
    if (part.readBigInts === true) readBigInts = true;
    if ("text" in part) {
      sql += part.text;
      continue;
    }
    params.push(part.param);
    sql += dialect === "sqlite" ? "?" : `$${String(params.length)}`;
  }
  return { text: sql, params, readBigInts };
}
