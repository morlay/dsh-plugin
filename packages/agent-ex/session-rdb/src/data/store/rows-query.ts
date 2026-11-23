// 会话行列表（管理面 `rows`）的条件构造：搜索两段式 + 结构化过滤 + 分页。
//
// 判据：能在库里判的就在库里判。搜索是「标题先前缀（范围比较）、无结果再全文（LIKE %x%）」，两段都拿
// lower(f_title) 比（大小写不敏感是产品口径）；时间 / 来源 / 归档与搜索进同一个 WHERE；分页参数在这里夹住上限。
//
// 已接受的债：前缀段的范围条件比的是 lower(f_title)，用不上原列索引 idx_sessions_title（它是原列的 BINARY
// 索引），SQLite 上退化成扫表。会话量级不大，先保语义；索引优化（表达式索引 / 归一列）另记。
import {
  and,
  concat,
  E,
  eq,
  gte,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  type Condition,
  type DialectName,
  type Fragment,
  type Operand,
} from "@morlay/zephyr-rdb";

// 一页的默认与上限：端点与直接调 store 的路径共用同一组数字。
export const ROWS_PAGE_SIZE_DEFAULT = 20;
export const ROWS_PAGE_SIZE_MAX = 200;

// 过滤条件与「搜索段」的形状在**共享面**：`SessionRowsFilterArgs` / 两个枚举在 `contract/`
// （`contract/session-rdb-store.contract.ts` 也要它们），「搜索段」那个枚举家在 `endpoint/`
// （它是 wire 上的字段，浏览器半也从那里取）。这里只转出，别再抄一份。
export type {
  SessionRowsArchivedFilter,
  SessionRowsFilterArgs,
  SessionRowsOriginFilter,
} from "../../contract/data-shapes.contract.ts";
export type { SessionRowsSearchStage } from "../../endpoint/session-admin-endpoint.ts";
import type { SessionRowsFilterArgs } from "../../contract/data-shapes.contract.ts";
import type { SessionRowsSearchStage } from "../../endpoint/session-admin-endpoint.ts";

// 条件构造要的列引用。
export interface SessionRowsColumns {
  readonly title: Operand;
  readonly origin: Operand;
  readonly archivedAt: Operand;
  readonly lastEventAt: Operand;
  readonly createdAt: Operand;
}

// 分页窗口。
export interface RowsWindow {
  readonly limit: number;
  readonly offset: number;
}

// 搜索词归一：去空白并小写（大小写不敏感是产品口径）。
function normalizeNeedle(needle: string | undefined): string {
  return needle?.trim().toLowerCase() ?? "";
}

/**
 * 两段式搜索的顺序：先前缀、再全文；空词不搜。
 *
 * @param needle - 原始搜索词（会去空白并小写）。
 * @returns 依次要跑的搜索段。
 */
export function sessionRowsSearchStages(
  needle: string | undefined,
): readonly SessionRowsSearchStage[] {
  return normalizeNeedle(needle) === "" ? [] : ["prefix", "contains"];
}

// 前缀范围的上界：任何以 prefix 开头的串都小于 prefix + U+10FFFF（比较的是 lower(f_title)）。
function prefixUpperBound(prefix: string): string {
  return prefix + "\u{10ffff}";
}

// 只在本方言出现的片段：另一方言整段丢弃（连参数一起）。
function dialectOnly(dialect: DialectName, source: Fragment): Fragment {
  return () => {
    const parts = [];
    for (const part of source()) parts.push({ ...part, only: dialect });
    return parts;
  };
}

/**
 * 搜索条件的一段：前缀走 lower(f_title) 的范围比较，全文走 lower(f_title) LIKE（两段都不走索引）。
 *
 * @param columns - 会话表的列引用。
 * @param needle - 搜索词（会去空白并小写）。
 * @param stage - 搜索段；`none` 表示不搜（只过滤）。
 * @returns SQL 条件；空词或不搜时 undefined。
 */
export function sessionRowsSearchCondition(
  columns: SessionRowsColumns,
  needle: string | undefined,
  stage: SessionRowsSearchStage,
): Condition | undefined {
  const normalized = normalizeNeedle(needle);
  if (normalized === "" || stage === "none") return undefined;
  if (stage === "contains") return like(E.lower(columns.title), "%" + normalized + "%");
  // 前缀两方言两种写法，判据都是「折过大小写的前缀」——与全文段同一个 lower(f_title) 口径：
  // - SQLite：范围比较（词已小写，比的是 lower(f_title)），Report A / report A 落在同一个区间里。
  // - PostgreSQL：默认排序规则下范围比较不保证前缀语义（中文按 collation 排），LIKE 才是前缀。
  return concat(
    [
      dialectOnly(
        "sqlite",
        and(
          gte(E.lower(columns.title), normalized),
          lt(E.lower(columns.title), prefixUpperBound(normalized)),
        ),
      ),
      dialectOnly("postgres", like(E.lower(columns.title), normalized + "%")),
    ],
    "",
  );
}

/**
 * 一页的取数条件：时间 + 来源 + 归档 + 搜索（按段），全部进同一个 WHERE。
 *
 * @param columns - 会话表的列引用。
 * @param args - 过滤条件。
 * @param stage - 搜索段；省略表示只过滤不搜索。
 * @returns SQL 条件；没有任何谓词时 undefined（等于不过滤）。
 */
export function sessionRowsCondition(
  columns: SessionRowsColumns,
  args: SessionRowsFilterArgs,
  stage?: SessionRowsSearchStage,
): Condition | undefined {
  const conditions: Condition[] = [];
  // 时间：与列表的 updatedAt 同一列（没有事件时回落创建时间）。
  const updatedAt = E.coalesce(columns.lastEventAt, columns.createdAt);
  if (args.updatedAfter !== undefined) conditions.push(gte(updatedAt, args.updatedAfter));
  if (args.updatedBefore !== undefined) conditions.push(lte(updatedAt, args.updatedBefore));
  // 来源：f_origin 对人类会话是 NULL，比较前先 COALESCE 成空串（两方言通用）。
  if (args.origin === "subagent") {
    conditions.push(eq(columns.origin, "subagent"));
  } else if (args.origin === "human" || args.includeSubagents === false) {
    conditions.push(ne(E.coalesce(columns.origin, ""), "subagent"));
  }
  // 归档：只看归档 / 只看未归档。
  if (args.archived === "only") conditions.push(isNotNull(columns.archivedAt));
  if (args.archived === "unarchived") conditions.push(isNull(columns.archivedAt));
  // 搜索：前缀走范围比较，全文走 LIKE；两段都比 lower(f_title)（大小写不敏感是产品口径）。
  if (stage !== undefined) {
    const search = sessionRowsSearchCondition(columns, args.query, stage);
    if (search !== undefined) conditions.push(search);
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}

/**
 * 分页窗口：默认一页、上限 200、偏移从 0 起；非整数与越界值回落到默认。
 *
 * @param args - 原始的分页参数。
 * @returns 夹住之后的分页窗口。
 */
export function pageWindow(args: {
  readonly limit?: number;
  readonly offset?: number;
}): RowsWindow {
  const requestedLimit = args.limit;
  const limit =
    requestedLimit !== undefined && Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, ROWS_PAGE_SIZE_MAX)
      : ROWS_PAGE_SIZE_DEFAULT;
  const requestedOffset = args.offset;
  const offset =
    requestedOffset !== undefined && Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;
  return { limit, offset };
}
