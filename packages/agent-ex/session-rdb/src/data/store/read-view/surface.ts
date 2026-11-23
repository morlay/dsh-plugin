// surface 操作的读视图修复：replace 的溯源、区间钳制与 metering 的范围同步。
//
// 判据是「读出来的视图要能折叠」：坏边界降级成 append，区间按 metering 的阴影数钳住。
import { SessionSeq } from "@morlay/dsh-session/contract";
import type { SessionEvent } from "@morlay/dsh-session/contract";

const SURFACE_EVENT_TYPES = new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result",
]);

const METERING_EVENT_TYPES = new Set(["compaction/summary", "compaction/prune"]);

// 升序的 surface 事件 seq 索引：读视图修复里的溯源（replace 的 `sourceEventSeqs` 与
// metering 的 `shadowedSeqs`）共用这一份，避免每个 replace 各扫一遍全量事件。
// 前提是输入按 seq 有序（`readLog` 与 live snapshot 都如此）。
function surfaceSeqIndex(events: readonly SessionEvent[]): number[] {
  const seqs: number[] = [];
  for (const event of events) {
    if (SURFACE_EVENT_TYPES.has(event.type)) seqs.push(event.seq);
  }
  return seqs;
}

// `[startSeq, endSeq]` 内的 surface seq（含端点），二分定位后切片。
function surfaceSeqsInRange(seqs: readonly number[], startSeq: number, endSeq: number): number[] {
  let low = 0;
  let high = seqs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (seqs[mid]! < startSeq) low = mid + 1;
    else high = mid;
  }
  const from = low;
  high = seqs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (seqs[mid]! <= endSeq) low = mid + 1;
    else high = mid;
  }
  return seqs.slice(from, low);
}

export function recomputeReplaceProvenance(events: SessionEvent[]): void {
  const seqs = surfaceSeqIndex(events);
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const raw = event as Record<string, unknown>;
    const op = raw.surfaceOp;
    if (typeof op !== "object" || op === null || (op as { op?: string }).op !== "replace") {
      continue;
    }
    const { startSeq, endSeq } = op as { startSeq: number; endSeq: number };
    const metering = i > 0 ? events[i - 1] : undefined;
    const meteringData =
      metering !== undefined && METERING_EVENT_TYPES.has(metering.type)
        ? (metering.data as Record<string, unknown>)
        : undefined;
    if (meteringData?.shadowedSeqs !== undefined) {
      raw.sourceEventSeqs = meteringData.shadowedSeqs;
      continue;
    }
    raw.sourceEventSeqs = surfaceSeqsInRange(seqs, startSeq, endSeq);
  }
}

function isEventSeqLike(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
  );
}

function isDeepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => isDeepEqualJson(item, b[i]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bRecord = b as Record<string, unknown>;
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(bRecord, key) &&
      isDeepEqualJson((a as Record<string, unknown>)[key], bRecord[key]),
  );
}

function toolResultRewriteContentOnly(original: SessionEvent, replacement: SessionEvent): boolean {
  // V4 起 `content` 就是结果内容本身（工具身份在消息顶层的 `toolCallId`），所以「只改结果」的
  // 重写等于「除了 `content` 之外逐字相同」。
  const originalData = original.data as Record<string, unknown>;
  const replacementData = replacement.data as Record<string, unknown>;
  const originalMessage = originalData["message"] as { content?: unknown } | undefined;
  const replacementMessage = replacementData["message"] as { content?: unknown } | undefined;
  if (!Array.isArray(originalMessage?.content) || !Array.isArray(replacementMessage?.content)) {
    return false;
  }
  const rest = (data: Record<string, unknown>, message: Record<string, unknown>): unknown => ({
    ...data,
    message: { ...message, content: null },
  });
  return isDeepEqualJson(
    rest(originalData, originalMessage as Record<string, unknown>),
    rest(replacementData, replacementMessage as Record<string, unknown>),
  );
}

export function findSurfaceRepairs(events: readonly SessionEvent[]): {
  degradeToAppend: Set<number>;
  addAppendMarker: Set<number>;
  clearSurfaceOp: Set<number>;
  clampEnd: Map<number, number>;
} {
  const nodes: number[] = [];
  const degradeToAppend = new Set<number>();
  const addAppendMarker = new Set<number>();
  const clearSurfaceOp = new Set<number>();
  const clampEnd = new Map<number, number>();
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    const raw = event as SessionEvent & { surfaceOp?: unknown };
    const op = raw.surfaceOp;
    if (op === undefined) {
      if (SURFACE_EVENT_TYPES.has(event.type)) {
        addAppendMarker.add(event.seq);
        nodes.push(event.seq);
      }
      continue;
    }
    if (op === "append") {
      if (SURFACE_EVENT_TYPES.has(event.type)) nodes.push(event.seq);
      else clearSurfaceOp.add(event.seq);
      continue;
    }
    if (!SURFACE_EVENT_TYPES.has(event.type)) {
      clearSurfaceOp.add(event.seq);
      continue;
    }
    const replace =
      typeof op === "object" && op !== null && !Array.isArray(op)
        ? (op as Record<string, unknown>)
        : undefined;
    const start = replace?.["startSeq"];
    const end = replace?.["endSeq"];
    const shapeOk =
      replace !== undefined &&
      replace["op"] === "replace" &&
      isEventSeqLike(start) &&
      isEventSeqLike(end);
    const startIdx = shapeOk ? nodes.indexOf(start as number) : -1;
    let endIdx = shapeOk ? nodes.indexOf(end as number) : -1;

    let clamped: number | undefined;
    if (shapeOk && startIdx !== -1 && endIdx === -1) {
      clamped = clampReplaceEnd(events, index, nodes, startIdx);
      if (clamped !== undefined) endIdx = nodes.indexOf(clamped);
    }
    const rangeOk = shapeOk && startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx;

    const provenanceOk = event.type !== "assistant/message";
    let rewriteOk = true;
    if (rangeOk && event.type === "tool/result") {
      const shadowed = nodes.slice(startIdx, endIdx + 1);
      if (shadowed.length !== 1) {
        rewriteOk = false;
      } else {
        const original = events[shadowed[0]!];
        rewriteOk =
          original?.type === "tool/result" && toolResultRewriteContentOnly(original, event);
      }
    }
    if (!rangeOk || !rewriteOk || !provenanceOk) {
      degradeToAppend.add(event.seq);
      nodes.push(event.seq);
      continue;
    }
    if (clamped !== undefined) clampEnd.set(event.seq, clamped);
    nodes.splice(startIdx, endIdx - startIdx + 1, event.seq);
  }
  return { degradeToAppend, addAppendMarker, clearSurfaceOp, clampEnd };
}

function clampReplaceEnd(
  events: readonly SessionEvent[],
  index: number,
  nodes: readonly number[],
  startIdx: number,
): number | undefined {
  const metering = index > 0 ? events[index - 1] : undefined;
  if (metering === undefined || !METERING_EVENT_TYPES.has(metering.type)) return undefined;
  const shadowedSeqs = (metering.data as Record<string, unknown>)["shadowedSeqs"];
  if (!Array.isArray(shadowedSeqs) || shadowedSeqs.length === 0) return undefined;
  return nodes[Math.min(startIdx + shadowedSeqs.length - 1, nodes.length - 1)];
}

export function repairSurfaceOps(events: SessionEvent[]): void {
  const repairs = findSurfaceRepairs(events);
  if (
    repairs.degradeToAppend.size === 0 &&
    repairs.addAppendMarker.size === 0 &&
    repairs.clearSurfaceOp.size === 0 &&
    repairs.clampEnd.size === 0
  ) {
    return;
  }
  for (const event of events) {
    const raw = event as SessionEvent & { surfaceOp?: unknown };
    const clamped = repairs.clampEnd.get(event.seq);
    if (repairs.degradeToAppend.has(event.seq)) {
      raw.surfaceOp = "append";
    } else if (clamped !== undefined) {
      const op = raw.surfaceOp as { startSeq: number };
      raw.surfaceOp = {
        op: "replace",
        startSeq: SessionSeq(op.startSeq),
        endSeq: SessionSeq(clamped),
      };
    } else if (repairs.addAppendMarker.has(event.seq)) {
      raw.surfaceOp = "append";
    } else if (repairs.clearSurfaceOp.has(event.seq)) {
      delete raw.surfaceOp;
    }
  }
}

export function syncMeteringRanges(events: SessionEvent[]): void {
  const seqs = surfaceSeqIndex(events);
  for (let i = 1; i < events.length; i++) {
    const metering = events[i - 1]!;
    if (!METERING_EVENT_TYPES.has(metering.type)) continue;
    const event = events[i]!;
    const op = (event as SessionEvent & { surfaceOp?: unknown }).surfaceOp;
    if (typeof op !== "object" || op === null || (op as { op?: string }).op !== "replace") continue;
    const { startSeq, endSeq } = op as { startSeq: number; endSeq: number };
    const data = metering.data as typeof metering.data & {
      shadowedRange?: { start: number; end: number };
      shadowedSeqs?: number[];
    };
    if (data.shadowedRange?.start === startSeq && data.shadowedRange.end === endSeq) continue;
    data.shadowedRange = { start: startSeq, end: endSeq };
    data.shadowedSeqs = surfaceSeqsInRange(seqs, startSeq, endSeq);
  }
}
