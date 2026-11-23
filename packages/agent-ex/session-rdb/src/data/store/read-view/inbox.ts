// 孤儿 inbox splice 的修复：目标不存在的拼接按「空操作」重写（保留事件坐标）。
import type { SessionEvent } from "@morlay/dsh-session/contract";

interface InboxSpliceLike {
  target?: unknown;
  start?: unknown;
  removedCount?: unknown;
  inserted?: Array<{ id?: unknown }>;
}

export function orphanInboxSpliceSeqs(events: readonly SessionEvent[]): Set<number> {
  const inbox: Record<string, Array<{ id: string }>> = { "next-turn": [], "next-step": [] };
  const orphan = new Set<number>();
  for (const raw of events) {
    const event = raw as { type: string; seq: number; data: InboxSpliceLike };
    if (event.type !== "agent/inbox/spliced") continue;
    const { target, start, removedCount, inserted } = event.data;
    const list = typeof target === "string" ? inbox[target] : undefined;
    if (list === undefined) {
      orphan.add(event.seq);
      continue;
    }
    const removed = removedCount ?? 0;
    const parsedInserted = (inserted ?? []).map((m) => ({
      id: typeof m.id === "string" ? m.id : "",
    }));
    if (
      !Number.isSafeInteger(start as number) ||
      (start as number) < 0 ||
      (start as number) > list.length ||
      !Number.isSafeInteger(removed as number) ||
      (removed as number) < 0 ||
      (start as number) + (removed as number) > list.length
    ) {
      orphan.add(event.seq);
      continue;
    }
    const candidate = [
      ...list.slice(0, start as number),
      ...parsedInserted,
      ...list.slice((start as number) + (removed as number)),
    ];
    const other = (target === "next-turn" ? inbox["next-step"] : inbox["next-turn"]) ?? [];
    const seen = new Set<string>();
    let dup = false;
    for (const m of [...candidate, ...other]) {
      if (m.id === "") continue;
      if (seen.has(m.id)) {
        dup = true;
        break;
      }
      seen.add(m.id);
    }
    if (dup) {
      orphan.add(event.seq);
      continue;
    }
    list.splice(start as number, removed as number, ...parsedInserted);
  }
  return orphan;
}

export function repairOrphanInboxSplices(events: SessionEvent[]): void {
  const orphan = orphanInboxSpliceSeqs(events);
  if (orphan.size === 0) return;
  for (const event of events) {
    if (!orphan.has(event.seq)) continue;
    const data = event.data as typeof event.data & InboxSpliceLike;
    const target = data.target;
    (event as { data: unknown }).data = {
      ...(typeof target === "string" ? { target } : { target: "next-turn" }),
      start: 0,
      removedCount: 0,
      inserted: [],
    };
  }
}
