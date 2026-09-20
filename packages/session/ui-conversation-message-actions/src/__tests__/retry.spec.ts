import SessionPersistenceSqlite from "@morlay/session-rdb";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  createPersisted,
  harness,
  meta,
  oneTurnLog,
  twoTurnLog,
  SessionIdBrand,
  SessionSeq,
  type SessionEvent,
} from "@morlay/ui-conversation-message-actions/testing";

function rdb(ctx: import("@deepseek-ai/cordis").Context): SessionPersistenceSqlite {
  return ctx.sessionPersistence as SessionPersistenceSqlite;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("SessionEditor retry", () => {
  it("retry truncates the original session in place (same session id)", async () => {
    const { ctx, editor, dispose } = await harness();
    try {
      await createPersisted(ctx, "src", twoTurnLog());
      const result = await editor.retry({
        action: "retry",
        sessionId: SessionIdBrand("src"),
        turn: 2,
        cascade: "truncate",
      });
      expect(result.sessionId).toBe(SessionIdBrand("src"));
      expect(result.queuedTurns).toBe(0);

      const after = await rdb(ctx).load(SessionIdBrand("src"));

      expect(after.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(after.events.some((e) => e.type === "session-branch/version")).toBe(false);
    } finally {
      await dispose();
    }
  });

  it("retry on a live session stays in place (same session id)", async () => {
    const { ctx, editor, dispose } = await harness();
    try {
      ctx.sessions.create(SessionIdBrand("live"), { meta: meta("live"), seed: [...twoTurnLog()] });
      const live = ctx.sessions.get(SessionIdBrand("live"))!;
      await ctx.sessions.flush(live);

      const result = await editor.retry({
        action: "retry",
        sessionId: SessionIdBrand("live"),
        turn: 2,
        cascade: "truncate",
      });
      expect(result.sessionId).toBe(SessionIdBrand("live"));

      expect(live.snapshotEvents().map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(live.snapshotEvents().some((e) => e.type === "session-branch/version")).toBe(false);

      const backend = (
        ctx.sessionPersistence as unknown as {
          internals(): {
            backend: { getHead(id: SessionIdBrand): Promise<{ fHeadSequence: number }> };
          };
        }
      ).internals().backend;
      const head = await backend.getHead(SessionIdBrand("live"));
      expect(head.fHeadSequence).toBe(5);
    } finally {
      await dispose();
    }
  });

  it("retry on a live session replays queued input through the live agent", async () => {
    const { ctx, editor, dispose } = await harness();
    try {
      const first = oneTurnLog().map(
        (e) => ({ ...e, seq: e.seq + 1, time: e.time + 1 }) as SessionEvent,
      );
      const header: SessionEvent = {
        type: "request/header",
        seq: SessionSeq(0),
        time: 1,
        data: {
          header: { config: { provider: "mock", model: "mock" } },
          reason: "initial",
        },
      } as SessionEvent;
      const second = oneTurnLog().map(
        (e) =>
          ({
            ...e,
            seq: e.seq + 7,
            time: e.time + 100,
            data: { ...e.data, turn: 2 },
          }) as SessionEvent,
      );
      ctx.sessions.create(SessionIdBrand("live"), {
        meta: meta("live"),
        seed: [header, ...first, ...second],
      });
      const live = ctx.sessions.get(SessionIdBrand("live"))!;
      await ctx.sessions.flush(live);

      const followups: unknown[] = [];
      const disposeAgents = ctx.provide("agents", {
        get: (id: SessionIdBrand) =>
          id === SessionIdBrand("live")
            ? {
                session: live,
                followup: (message: unknown) => {
                  followups.push(message);
                },
                whenIdle: async () => {},
                inbox: { clear: () => {} },
              }
            : undefined,
        create: async () => {
          throw new Error("unused");
        },
        resume: async () => {
          throw new Error("unused");
        },
      });

      const result = await editor.retry({
        action: "retry",
        sessionId: SessionIdBrand("live"),
        turn: 2,
        cascade: "truncate",
      });

      expect(result.sessionId).toBe(SessionIdBrand("live"));
      expect(followups).toHaveLength(1);

      expect(live.snapshotEvents().map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(live.snapshotEvents().some((e) => e.type === "session-branch/version")).toBe(false);
      disposeAgents();
    } finally {
      await dispose();
    }
  });

  // 就地重试仍是同一会话（session id 不变，不派生新会话）——读侧版本树已删除，
  // 判据改为「会话记录里仍然只有这一个会话」。
  it("in-place retry keeps a single session (no derived session)", async () => {
    const { ctx, editor, dispose } = await harness();
    try {
      await createPersisted(ctx, "src", twoTurnLog());
      await editor.retry({
        action: "retry",
        sessionId: SessionIdBrand("src"),
        turn: 2,
        cascade: "truncate",
      });

      const persisted = ctx.sessionPersistence as SessionPersistenceSqlite;
      const snapshots = await persisted.listSnapshots();
      expect(snapshots.map((snapshot) => snapshot.header.id)).toEqual([SessionIdBrand("src")]);
    } finally {
      await dispose();
    }
  });
});
