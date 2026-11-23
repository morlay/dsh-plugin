// 事件定位：**行的读**。条件全部下推到 SQL（文本 LIKE / 类型 / 角色 / 名字 / 时间 / seq 窗口），
// 只回序号、行上的维度与命中片段，不把整段日志搬进内存。
//
// 与读路径的分工：读路径要解析整段日志（坏一行就整份读不出来），定位只扫命中的行——所以坏会话照样
// 能定位（排障时先用它看坏在哪一行，再去 repair）。
import {
  count,
  E,
  gte,
  inList,
  like,
  lte,
  type Condition,
  type Database,
} from "@morlay/zephyr-rdb";
import { extractSessionEventText } from "@morlay/dsh-session/contract";
import { events, sessionEvents } from "../data/entities/index.ts";
import { SessionStoreError } from "../data/errors.ts";
import { rowToEvent } from "../data/store/log/rows.ts";
import type { EventRow, SessionRow } from "../data/backend.ts";
import type { SessionEventLocatorQuery } from "../contract/session-rdb-store.contract.ts";
import type { SessionLocateItem, SessionLocateValue } from "../endpoint/session-admin-endpoint.ts";

// 一页最多回多少条命中：定位回答「在哪儿」，不是把整段日志导出来。
const LOCATE_LIMIT_MAX = 200;
const LOCATE_LIMIT_DEFAULT = 50;

// 命中片段：命中点两侧各留多少字符，以及没有文本条件时的截断长度。
const SNIPPET_RADIUS = 40;
const SNIPPET_MAX = 80;

// 一条命中行取出来的列（片段从事件原文或它的语义文本里裁）。
interface LocatedRow {
  readonly f_event_id: unknown;
  readonly f_sequence: unknown;
  readonly f_type: unknown;
  readonly f_kind: unknown;
  readonly f_role: unknown;
  readonly f_name: unknown;
  readonly f_action_id: unknown;
  readonly f_created_at: unknown;
  readonly f_data: unknown;
  readonly f_surface_op: unknown;
}

// 一个生效的 seq 窗口与日志长度。
interface LocatedWindow {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly logLength: number;
}

/**
 * 会话不存在时的拒绝（与删除 / 导出同一口径）。
 *
 * @param sessionId - 会话 id。
 * @returns 带域码的拒绝。
 */
export function sessionNotFound(sessionId: string): SessionStoreError {
  return new SessionStoreError("SESSION_NOT_FOUND", `session "${sessionId}" not found`);
}

/**
 * 把请求的 seq 窗口校验成一个可用的闭区间。
 *
 * 越界（超过日志长度）、两端颠倒、不是非负整数都显式失败：静默夹取会让「看的是哪一段」变成猜测。
 * @param sessionId - 会话 id（进错误文案）。
 * @param headSequence - 会话行的 head（日志长度 = head + 1）。
 * @param query - 原始查询。
 * @returns 生效窗口与日志长度。
 */
export function locateWindow(
  sessionId: string,
  headSequence: number,
  query: SessionEventLocatorQuery,
): LocatedWindow {
  const logLength = Math.max(Number(headSequence) + 1, 0);
  const fromSeq = query.fromSeq ?? 0;
  const toSeq = query.toSeq ?? Math.max(logLength - 1, 0);
  const invalid = (detail: string): SessionStoreError =>
    new SessionStoreError(
      "SESSION_QUERY_INVALID_WINDOW",
      `session "${sessionId}" seq window [${String(fromSeq)}, ${String(toSeq)}] is invalid: ${detail}`,
    );
  if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) {
    throw invalid("fromSeq must be a non-negative integer");
  }
  if (!Number.isSafeInteger(toSeq) || toSeq < 0) {
    throw invalid("toSeq must be a non-negative integer");
  }
  if (fromSeq > toSeq) throw invalid("fromSeq is greater than toSeq");
  if (toSeq >= logLength) {
    throw invalid(`toSeq exceeds the last seq of the log (${String(logLength - 1)})`);
  }
  return { fromSeq, toSeq, logLength };
}

/**
 * 定位一个会话里的事件。
 *
 * @param rdb - 执行面（两方言通用）。
 * @param sessionId - 会话 id。
 * @param row - 会话行；undefined 表示不存在（这里给 SESSION_NOT_FOUND）。
 * @param query - 定位条件。
 * @returns 命中的片段、命中总数与生效窗口。
 */
export async function locateSessionEvents(
  rdb: Database,
  sessionId: string,
  row: SessionRow | undefined,
  query: SessionEventLocatorQuery = {},
): Promise<SessionLocateValue> {
  if (row === undefined) throw sessionNotFound(sessionId);
  const window = locateWindow(sessionId, row.fHeadSequence, query);
  if (window.logLength === 0) {
    // 空日志没有可读的 seq：空结果是答案，不是越界。
    return { sessionId, items: [], total: 0, window: { fromSeq: 0, toSeq: 0 } };
  }

  const needle = query.text?.trim().toLowerCase() ?? "";
  const links = sessionEvents.table(rdb);
  const eventTable = events.table(rdb);
  const conditions: Condition[] = [
    E.eq(links.f_session_id, sessionId),
    gte(links.f_sequence, window.fromSeq),
    lte(links.f_sequence, window.toSeq),
  ];
  if (query.types !== undefined && query.types.length > 0) {
    conditions.push(inList(eventTable.f_type, [...query.types]));
  }
  if (query.role !== undefined) conditions.push(E.eq(eventTable.f_role, query.role));
  if (query.name !== undefined) conditions.push(E.eq(eventTable.f_name, query.name));
  if (query.fromTime !== undefined) {
    conditions.push(gte(eventTable.f_created_at, query.fromTime));
  }
  if (query.toTime !== undefined) conditions.push(lte(eventTable.f_created_at, query.toTime));
  if (needle !== "") conditions.push(like(E.lower(eventTable.f_data), "%" + needle + "%"));
  const where = E.and(...conditions);

  const items: SessionLocateItem[] = [];
  for await (const hit of links
    .select({
      f_event_id: eventTable.f_event_id,
      f_sequence: links.f_sequence,
      f_type: eventTable.f_type,
      f_kind: eventTable.f_kind,
      f_role: eventTable.f_role,
      f_name: eventTable.f_name,
      f_action_id: eventTable.f_action_id,
      f_created_at: eventTable.f_created_at,
      f_data: eventTable.f_data,
      f_surface_op: links.f_surface_op,
    })
    .join(events, E.eq(eventTable.f_event_id, links.f_event_id))
    .where(where)
    .orderBy("f_sequence", "asc")
    .limit(locateLimit(query.limit))) {
    items.push(toItem(hit, needle));
  }

  let total = 0;
  for await (const counted of links
    .select({ n: count() })
    .join(events, E.eq(eventTable.f_event_id, links.f_event_id))
    .where(where)) {
    total = Number(counted.n);
  }
  return { sessionId, items, total, window: { fromSeq: window.fromSeq, toSeq: window.toSeq } };
}

// 一页的条数：非法值回落到默认，超过上限按上限。
function locateLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isSafeInteger(limit) || limit <= 0)
    return LOCATE_LIMIT_DEFAULT;
  return Math.min(limit, LOCATE_LIMIT_MAX);
}

// 一条命中行 → 页面要的条目。
function toItem(hit: LocatedRow, needle: string): SessionLocateItem {
  const role = String(hit.f_role);
  const name = String(hit.f_name);
  return {
    seq: Number(hit.f_sequence),
    type: String(hit.f_type),
    role: role === "" ? null : role,
    name: name === "" ? null : name,
    time: Number(hit.f_created_at),
    snippet: snippetOf(hit, needle),
  };
}

// 命中片段：优先取事件语义文本（原文是 JSON，直接给用户看是噪音）；语义读不出来时退回原文。
function snippetOf(hit: LocatedRow, needle: string): string {
  const raw = String(hit.f_data);
  if (needle === "") return clip(semanticTextOf(hit) ?? raw);
  const text = semanticTextOf(hit);
  if (text !== undefined && text.toLowerCase().includes(needle)) return around(text, needle);
  return around(raw, needle);
}

// 事件原文 → 语义文本；原文解不出来（坏行）时给 undefined：定位不该因为坏行而失败。
function semanticTextOf(hit: LocatedRow): string | undefined {
  try {
    const text = extractSessionEventText(rowToEvent(toEventRow(hit)));
    return text.length === 0 ? undefined : text;
  } catch {
    /* 坏行：片段退回原文，定位不因它失败。 */
    return undefined;
  }
}

// 命中点的上下文：两侧各留 SNIPPET_RADIUS 个字符，被裁掉的一侧打省略号。
function around(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return clip(text);
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + needle.length + SNIPPET_RADIUS);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// 没有命中点时的截断。
function clip(text: string): string {
  return text.length <= SNIPPET_MAX ? text : text.slice(0, SNIPPET_MAX) + "…";
}

// 命中行 → 事件行（语义抽取要的类型）。
function toEventRow(hit: LocatedRow): EventRow {
  return {
    fEventId: String(hit.f_event_id),
    fSequence: Number(hit.f_sequence),
    fType: String(hit.f_type),
    fKind: String(hit.f_kind),
    fRole: String(hit.f_role),
    fName: String(hit.f_name),
    fActionId: String(hit.f_action_id),
    fCreatedAt: Number(hit.f_created_at),
    fData: String(hit.f_data),
    fSurfaceOp: typeof hit.f_surface_op === "string" ? hit.f_surface_op : null,
  };
}
