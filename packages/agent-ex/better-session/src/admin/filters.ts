// 查询条件 → SQL：把 SessionResultFilter / SessionEventResultFilter 翻成 WHERE 条件。
//
// 判据：**能在库里判的就在库里判**。以前这两个面是把整份会话行 / 整段日志取进内存再 filter，1 万条事件的
// 会话上一次筛选要把 1 万条事件 JSON 全读出来；现在条件进 WHERE，只物化命中的那几行。
//
// 不翻的两件：
// - availability：它不是列（live 是进程内事实、persisted 是"行存在"），由调用方按来源分流；
// - surface：它由 surface 折叠算出（replace 覆盖了谁），不是列。会话里没有 replace 时调用方可以按
//   f_surface_op 直接判，有 replace 时只能读全量算。
import {
  and,
  between,
  E,
  gte,
  inList,
  isNull,
  lte,
  type Condition,
  type Operand,
} from "@morlay/zephyr-rdb";
import {
  extractSessionEventText,
  type SessionEvent,
  type SessionEventResultFilter,
  type SessionEventSearchDocument,
  type SessionId,
  type SessionResultFilter,
  type SessionResultRange,
} from "@morlay/dsh-session/contract";

export interface SessionFilterColumns {
  readonly id: Operand;
  readonly cwd: Operand;
  readonly createdAt: Operand;
  readonly parent: Operand;
}

export interface EventFilterColumns {
  readonly seq: Operand;
  readonly time: Operand;
  readonly type: Operand;
}

/**
 * 会话行条件：availability 之外的全部谓词。
 *
 * @param filters - 已 materialize 的筛选条件。
 * @param columns - 会话表的列引用。
 * @returns SQL 条件；没有可下推的谓词时 undefined（等于不过滤）。
 */
export function sessionFilterCondition(
  filters: readonly SessionResultFilter[],
  columns: SessionFilterColumns,
): Condition | undefined {
  const conditions: Condition[] = [];
  for (const filter of filters) {
    switch (filter.kind) {
      case "id":
        conditions.push(inList(columns.id, filter.values));
        break;
      case "cwd": {
        // null 在 SQL 里是 IS NULL，不能写成 IN (…)（NULL 与任何值都不相等）。
        conditions.push(nullableInList(columns.cwd, filter.values));
        break;
      }
      case "parent": {
        conditions.push(nullableInList(columns.parent, filter.values));
        break;
      }
      case "created-at":
        conditions.push(rangeCondition(columns.createdAt, filter));
        break;
      case "availability":
        // 来源分流，不是列（见文件头）。
        break;
      default:
        // 未知条件由 materialize 阶段挡住；到这里保持"不过滤"，让上层的语义断言报错。
        break;
    }
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}

/**
 * 事件行条件：seq / time / type。
 *
 * @param filters - 已 materialize 的筛选条件。
 * @param columns - 事件表的列引用。
 * @returns SQL 条件；没有可下推的谓词时 undefined。
 */
export function eventFilterCondition(
  filters: readonly SessionEventResultFilter[],
  columns: EventFilterColumns,
): Condition | undefined {
  const conditions: Condition[] = [];
  for (const filter of filters) {
    switch (filter.kind) {
      case "seq":
        conditions.push(rangeCondition(columns.seq, filter));
        break;
      case "time":
        conditions.push(rangeCondition(columns.time, filter));
        break;
      case "type":
        conditions.push(inList(columns.type, filter.values));
        break;
      case "surface":
      case "text":
        // surface 要折叠结果、text 要语义抽取（不是原文匹配，见设计文档）：都不下推。
        break;
      default:
        break;
    }
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}

// 区间条件：两端都可省略（省略即开区间）。两端都在时用 BETWEEN：绑定参数少一个。
function rangeCondition(column: Operand, range: SessionResultRange): Condition {
  if (range.from !== undefined && range.to !== undefined) {
    return between(column, range.from, range.to);
  }
  if (range.from !== undefined) return gte(column, range.from);
  if (range.to !== undefined) return lte(column, range.to);
  return E.always();
}

// 可空列上的 IN：null 走 IS NULL，其余走 IN，两者 OR。
function nullableInList<T extends string>(
  column: Operand,
  values: readonly (T | null)[],
): Condition {
  const present = values.filter((value): value is T => value !== null);
  const clauses: Condition[] = [];
  if (present.length > 0) clauses.push(inList(column, present));
  if (values.some((value) => value === null)) clauses.push(isNull(column));
  if (clauses.length === 0) return E.never();
  if (clauses.length === 1) return clauses[0] as Condition;
  return E.or(...clauses);
}

/**
 * 来源分流：`availability` 不是列（live 是进程内事实、persisted 是"行存在"）。
 *
 * @param filters - 已 materialize 的会话筛选条件。
 * @returns 要查库（persisted）与要遍历 live 表（live）两个开关；没有该条件时两者都要（不过滤=并集）。
 */
export function availabilityOf(filters: readonly SessionResultFilter[]): {
  readonly live: boolean;
  readonly persisted: boolean;
} {
  let live = true;
  let persisted = true;
  for (const filter of filters) {
    if (filter.kind !== "availability") continue;
    live = filter.values.includes("live");
    persisted = filter.values.includes("persisted");
  }
  return { live, persisted };
}

/**
 * 没有 replace 的会话里，哪些 seq 是当前 surface 节点：带 `f_surface_op` 的那几行（append 即 current）。
 *
 * @param metas - 全量事件坐标（`selectEventMetas`：不含 `f_data`）。
 * @returns current 节点的 seq 集合。
 */
export function currentSurfaceSeqs(
  metas: ReadonlyArray<{ seq: number; surfaceOp: string | null }>,
): ReadonlySet<number> {
  const seqs = new Set<number>();
  for (const meta of metas) if (meta.surfaceOp !== null) seqs.add(meta.seq);
  return seqs;
}

/**
 * 一条命中的事件行 → 搜索文档（与上游 `buildSessionEventSearchDocuments` 同一判据：没有语义文本就不收）。
 *
 * @param sessionId - 会话身份。
 * @param event - 命中的事件（`rowToEvent` 已解析 `f_data`）。
 * @param current - current surface 节点的 seq 集合。
 * @returns 文档；事件没有可检索文本时 undefined。
 */
export function searchDocumentOf(
  sessionId: SessionId,
  event: SessionEvent,
  current: ReadonlySet<number>,
): SessionEventSearchDocument | undefined {
  const text = extractSessionEventText(event);
  if (text.length === 0) return undefined;
  return {
    sessionId,
    seq: event.seq,
    type: event.type,
    time: event.time,
    surface: current.has(event.seq) ? "current" : "log-only",
    text,
  };
}
