import { describe, expect, test } from "@morlay/session-rdb/testing";

import { SessionId, SessionSeq, type SessionEvent } from "@morlay/dsh-session/contract";
import { SessionPersistenceRdb as SessionPersistenceSqlite } from "@morlay/session-rdb";
import { meta } from "@morlay/dsh-session/testing";
import { orphanInboxSpliceSeqs, repairOrphanInboxSplices } from "@morlay/session-rdb";
import { createCtx, mountOnto } from "../../__tests__/support/base.ts";
import { MessageId, createUserMessage } from "@morlay/dsh-agent/contract";

function splice(
  seq: number,
  target: "next-turn" | "next-step",
  start: number,
  removed: number,
  inserted: Array<{ id: string }>,
): SessionEvent {
  return {
    type: "agent/inbox/spliced",
    seq: SessionSeq(seq),
    time: seq,
    // 按上游 `agent/inbox/spliced` 的真形状装（`core/agent/src/types.ts:110-116`）：`start` 是**裸 number**
    // （上游这里没有品牌化）、`inserted` 必填、`removedCount` 在 0 时不写、`outcome` 本用例不用。
    data: {
      target,
      start,
      ...(removed === 0 ? {} : { removedCount: removed }),
      // `inserted` 里的项是**真消息**（上游 `Inbox` 会按消息面读），不是只有 id 的占位：
      // 盘上那条 `Cannot use 'in' operator to search for 'plugin' in undefined` 就是这条形状写歪暴露的。
      inserted: inserted.map((item) => ({
        ...createUserMessage({
          content: [{ type: "text", text: item.id }],
          source: { kind: "user" },
        }),
        id: MessageId(item.id),
      })),
    },
    // 形状与上游一致后不再需要断言；若这里又红，说明还有别的字段差额（列出来，别硬凑）。
    // 卡点（票 03 第 7 类）：`inserted` 已是**真消息**，剩下的差额在上游 `agent/inbox/spliced` 的 data
    // 其余字段（`version` 等）——没摸清前不猜，留着这条断言。
  };
}

describe("orphanInboxSpliceSeqs", () => {
  test("accepts a self-consistent splice stream", () => {
    const events = [splice(0, "next-turn", 0, 0, [{ id: "a" }]), splice(1, "next-turn", 0, 1, [])];
    expect(orphanInboxSpliceSeqs(events).size).toBe(0);
  });

  test("flags an insert beyond the empty queue (rewind dropped the prior queued message)", () => {
    const events = [
      splice(0, "next-turn", 0, 0, [{ id: "queued-before-rewind" }]),
      splice(1, "next-turn", 1, 0, [{ id: "b" }]),
      splice(2, "next-turn", 0, 1, []),
      splice(3, "next-step", 0, 0, [{ id: "b" }]),
    ];

    const afterRewind = events.slice(1);
    const orphan = orphanInboxSpliceSeqs(afterRewind);

    expect(orphan.has(1)).toBe(true);
  });

  test("rewrites orphans to no-op so the stream replays from empty", () => {
    const events = [
      splice(0, "next-turn", 1, 0, [{ id: "b" }]),
      splice(1, "next-turn", 0, 1, []),
      splice(2, "next-step", 0, 0, [{ id: "c" }]),
      splice(3, "next-step", 0, 1, []),
    ];
    repairOrphanInboxSplices(events);
    expect(orphanInboxSpliceSeqs(events).size).toBe(0);

    const fixed = events[0] as unknown as {
      data: { target: string; start: number; removedCount: number; inserted: unknown[] };
    };
    expect(fixed.data.target).toBe("next-turn");
    expect(fixed.data.start).toBe(0);
    expect(fixed.data.removedCount).toBe(0);
    expect(fixed.data.inserted).toEqual([]);
    const fixed1 = events[1] as unknown as {
      data: { target: string; start: number; removedCount: number };
    };
    expect(fixed1.data.target).toBe("next-turn");
    expect(fixed1.data.removedCount).toBe(0);

    const kept = events[2] as unknown as { data: { start: number; inserted: unknown[] } };
    expect(kept.data.start).toBe(0);
    expect(kept.data.inserted).toHaveLength(1);
  });

  test("flags a duplicate id across pending lists", () => {
    const events = [
      splice(0, "next-turn", 0, 0, [{ id: "x" }]),
      splice(1, "next-step", 0, 0, [{ id: "x" }]),
    ];
    expect(orphanInboxSpliceSeqs(events).has(1)).toBe(true);
  });
});

async function harness() {
  const ctx = createCtx();
  const fiber = await mountOnto(ctx, { config: { type: "sqlite", path: ":memory:" } });
  const persistence = ctx.sessionPersistence as unknown as SessionPersistenceSqlite;
  return { ctx, persistence, dispose: () => fiber.dispose() };
}

describe("loadStored repairs orphan inbox splices", () => {
  test("returns a stream the upstream Inbox can replay after a rewind dropped the queued insert", async () => {
    const { persistence, dispose } = await harness();
    try {
      const turn: SessionEvent[] = [
        { type: "turn/start", seq: SessionSeq(0), time: 1, data: { turn: 1 } },
        {
          type: "user/message",
          seq: SessionSeq(1),
          time: 2,
          data: {
            id: MessageId("u1"),
            role: "user",
            content: [{ type: "text", text: "hi" }],
            source: { kind: "user" },
          },
          surfaceOp: "append",
        },
        { type: "step/start", seq: SessionSeq(2), time: 3, data: { turn: 1, step: 1 } },
        {
          type: "assistant/message",
          seq: SessionSeq(3),
          time: 4,
          data: {
            turn: 1,
            step: 1,
            message: {
              id: MessageId("a1"),
              role: "assistant",
              content: [{ type: "text", text: "hello" }],
              source: { kind: "model", provider: "mock", model: "mock" },
            },
            stream: [],
          },
          surfaceOp: "append",
        },
        { type: "step/end", seq: SessionSeq(4), time: 5, data: { turn: 1, step: 1 } },
        {
          type: "turn/end",
          seq: SessionSeq(5),
          time: 6,
          data: { turn: 1, reason: { kind: "completed" } },
        },

        splice(6, "next-turn", 1, 0, [{ id: "queued-after" }]),
        splice(7, "next-turn", 0, 1, []),

        { type: "turn/start", seq: SessionSeq(8), time: 8, data: { turn: 2 } },
        splice(9, "next-turn", 0, 0, [{ id: "turn2-input" }]),
        {
          type: "user/message",
          seq: SessionSeq(10),
          time: 10,
          data: {
            id: MessageId("u2"),
            role: "user",
            content: [{ type: "text", text: "go on" }],
            source: { kind: "user" },
          },
          surfaceOp: "append",
        },
        { type: "step/start", seq: SessionSeq(11), time: 11, data: { turn: 2, step: 1 } },
      ];
      const m = meta("bad");
      await persistence.createAndAppend(m, turn);

      const handle = await persistence.open(SessionId("bad"), "read");
      const { events } = await handle.read();
      await handle.close();
      expect(events).toHaveLength(turn.length);

      expect(orphanInboxSpliceSeqs(events).size).toBe(0);

      const raw = await persistence.backend.reads.getEventRows(SessionId("bad"));
      const rawEvents = raw.map((row) => ({
        type: row.fType,
        seq: row.fSequence,
        time: row.fCreatedAt,
        data: JSON.parse(row.fData),
      })) as SessionEvent[];
      expect(orphanInboxSpliceSeqs(rawEvents).size).toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });
});
