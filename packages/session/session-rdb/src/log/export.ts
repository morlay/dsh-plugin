import type { SessionEvent, SessionHeader } from "@deepseek-ai/dsh-session";
import type { SessionFormatEvent, SessionFormatHeader } from "@deepseek-ai/dsh-session-format";
import { sessionFormatCatalog } from "@deepseek-ai/dsh-session-format-catalog";
import type { EventRow } from "../backend.ts";
import { rowToEvent } from "./rows.ts";

export function scanRows(
  rows: readonly EventRow[],
  base = 0,
): { preserved: SessionEvent[]; tornFrom?: number } {
  // 已提交区（最后一个 `turn/end` 及之前）必须完整：坏行/断号只有在它之后才允许当作撕裂尾部丢掉。
  // 倒序只为找到这个边界，先按行类型筛（绝大多数行直接跳过），再解析候选行确认它本身可读。
  let lastTurnEnd = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.fType !== "turn/end") continue;
    try {
      rowToEvent(rows[i] as EventRow);
      lastTurnEnd = i;
      break;
    } catch {
      /* 这个 turn/end 自身坏掉：继续往前找上一个可读的边界。 */
    }
  }

  const preserved: SessionEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    let event: SessionEvent;
    try {
      event = rowToEvent(rows[i] as EventRow);
    } catch {
      if (i <= lastTurnEnd)
        throw new Error(
          `corrupt session log: unparsable committed event at seq ${rows[i]?.fSequence}`,
        );
      break;
    }
    if (event.seq !== base + i) {
      if (i <= lastTurnEnd)
        throw new Error(
          `corrupt session log: seq gap in committed region (expected ${base + i}, got ${event.seq})`,
        );
      break;
    }
    preserved.push(event);
  }

  return preserved.length < rows.length
    ? { preserved, tornFrom: base + preserved.length }
    : { preserved };
}

export function toJsonlArtifact(
  meta: SessionHeader,
  inheritedEventCount: number,
  events: readonly SessionEvent[],
): string {
  const header = sessionFormatCatalog.encodeCurrentHeader(
    {
      ...meta,
      delegationDepth: meta.delegationDepth ?? 0,
    } as unknown as SessionFormatHeader,
    inheritedEventCount,
  );
  const lines = [JSON.stringify(header)];
  for (const event of events) {
    lines.push(
      JSON.stringify(
        sessionFormatCatalog.encodeCurrentEvent(event as unknown as SessionFormatEvent),
      ),
    );
  }
  return lines.join("\n");
}

export function titleOfEventData(data: string): string | undefined {
  try {
    const value = JSON.parse(data) as { data?: { title?: unknown }; title?: unknown };
    const title = value.data?.title ?? value.title;
    return typeof title === "string" ? title : undefined;
  } catch {
    return undefined;
  }
}

