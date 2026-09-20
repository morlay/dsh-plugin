import { Context } from "@deepseek-ai/cordis";
import { SessionId, SessionSeq, SessionStore, type SessionEvent } from "@deepseek-ai/dsh-session";
import { describe, expect, it } from "vitest";
import SessionPersistenceSqlite from "@morlay/session-rdb";
import { EmptySettings, meta, oneTurnLog } from "@morlay/session-rdb/testing";
import type { Backend } from "../backend.ts";
import { repairReadView } from "../log.ts";

async function mount(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context();
  await ctx.plugin(EmptySettings);
  await ctx.plugin(SessionStore);
  const fiber = await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: ":memory:" });
  return { ctx, dispose: () => fiber.dispose() };
}

function persistenceOf(ctx: Context): InstanceType<typeof SessionPersistenceSqlite> {
  return ctx.sessionPersistence as InstanceType<typeof SessionPersistenceSqlite>;
}

function backendOf(ctx: Context): Backend {
  return persistenceOf(ctx).internals().backend;
}

/** 记录后端事件行查询的次数：接缝观测，用来证明读取路径没有重复拉全量。 */
function countEventRows(ctx: Context): { rows: number } {
  const backend = backendOf(ctx);
  const counts = { rows: 0 };
  const original = backend.getEventRows.bind(backend);
  backend.getEventRows = async (id, fromSequence) => {
    counts.rows += 1;
    return original(id, fromSequence);
  };
  return counts;
}

async function persistOneTurn(ctx: Context, id: string): Promise<void> {
  const handle = await ctx.sessionPersistence.create(meta(id));
  try {
    await handle.append(oneTurnLog());
  } finally {
    await handle.close();
  }
}

function surfaceEvent(seq: number, text: string, surfaceOp?: unknown): SessionEvent {
  return {
    type: "user/message",
    seq: SessionSeq(seq),
    time: seq,
    data: {
      id: `m${String(seq)}`,
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    },
    ...(surfaceOp === undefined ? {} : { surfaceOp }),
  } as unknown as SessionEvent;
}

/**
 * 一段含 replace 与 metering 的日志：seq 1/2 被 seq 3（replace 1..2）折叠，
 * seq 3 又被 metering 之后的 seq 5（replace 3..3）折叠。
 */
function replaceHeavyLog(): SessionEvent[] {
  return [
    surfaceEvent(0, "a", "append"),
    surfaceEvent(1, "b", "append"),
    surfaceEvent(2, "c", "append"),
    surfaceEvent(3, "bc", { op: "replace", startSeq: 1, endSeq: 2 }),
    {
      type: "compaction/summary",
      seq: SessionSeq(4),
      time: 4,
      data: { shadowedRange: { start: 0, end: 0 }, shadowedSeqs: [] },
    } as unknown as SessionEvent,
    surfaceEvent(5, "z", { op: "replace", startSeq: 3, endSeq: 3 }),
  ];
}

describe("读路径", () => {
  // load 是会话打开（cold read）的入口：它自己再开一条读取路径就等于把最贵的读付两遍。
  it("load 只读一遍事件", async () => {
    const { ctx, dispose } = await mount();
    try {
      await persistOneTurn(ctx, "s1");
      const counts = countEventRows(ctx);

      const inspected = await persistenceOf(ctx).load(SessionId("s1"));

      expect(inspected.events).toHaveLength(oneTurnLog().length);
      expect(counts.rows).toBe(1);
    } finally {
      await dispose();
    }
  });

  // 读视图修复的溯源要在一次扫描里建好索引：replace 的 sourceEventSeqs 与 metering 的
  // shadowedSeqs 从同一份 surface 序列里取（原先每个 replace 各扫一遍全量事件）。
  it("repairReadView 折叠出 replace 的溯源与 metering 的阴影序列", () => {
    const events = replaceHeavyLog();
    repairReadView(events);

    expect((events[3] as unknown as { sourceEventSeqs?: number[] }).sourceEventSeqs).toEqual([
      1, 2,
    ]);
    expect(
      (events[4] as unknown as { data: { shadowedSeqs?: number[] } }).data.shadowedSeqs,
    ).toEqual([3]);
    expect((events[5] as unknown as { sourceEventSeqs?: number[] }).sourceEventSeqs).toEqual([3]);
  });

  // rewind 的边界 / 窗口探测只要类型：查询不能连带把整个事件 JSON（f_data）拖回来。
  it("rewind 的类型查询只取 fSequence / fType 两列", async () => {
    const { ctx, dispose } = await mount();
    try {
      await persistOneTurn(ctx, "s1");
      const backend = backendOf(ctx);

      const at = await backend.getEventTypeAt(SessionId("s1"), 1);
      const before = await backend.getEventTypesBefore(SessionId("s1"), 5, 2);

      expect(at).toBe("user/message");
      expect(before.map((row) => row.fType)).toEqual(["step/end", "assistant/message"]);
      for (const row of before) {
        expect(Object.keys(row).sort()).toEqual(["fSequence", "fType"]);
      }
    } finally {
      await dispose();
    }
  });
});
