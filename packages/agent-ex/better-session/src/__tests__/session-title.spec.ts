import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SessionId,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from "@morlay/dsh-session/contract";
import { meta, oneTurnLog } from "@morlay/dsh-session/testing";
import { titleOfEventData } from "@morlay/better-session";
import { createCtx, mountOnto } from "./support/base.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function titleEvent(title: string, seq: number): SessionEvent {
  return {
    type: "session/title",
    seq: SessionSeq(seq),
    time: seq + 1,
    data: { title, messageSeqs: [], source: "auto" },
  } as unknown as SessionEvent;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the service");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("session title as session data", () => {
  it("maintains the title column from title events and rewinds it", async () => {
    const root = await tempDir("session-title-");
    const dbPath = join(root, "sessions.sqlite");
    const ctx = createCtx();
    const fiber = await mountOnto(ctx, { config: { type: "sqlite", path: dbPath } });
    try {
      const id = SessionId("titled");
      ctx.sessions.create(id, {
        meta: meta("titled"),
        seed: [...oneTurnLog(), titleEvent("第一个标题", 6)],
      });
      const live = ctx.sessions.get(id)!;
      await ctx.sessions.flush(live);

      const db = new DatabaseSync(dbPath);
      try {
        const row = db
          .prepare("SELECT f_title, f_title_seq FROM t_sessions WHERE f_session_id = 'titled'")
          .get() as { f_title: string; f_title_seq: number };
        expect(row.f_title).toBe("第一个标题");
        expect(row.f_title_seq).toBe(6);
      } finally {
        db.close();
      }

      await ctx.sessionBranch.rewind(id, 5);
      const after = new DatabaseSync(dbPath);
      try {
        const row = after
          .prepare("SELECT f_title, f_title_seq FROM t_sessions WHERE f_session_id = 'titled'")
          .get() as { f_title: string | null; f_title_seq: number | null };
        expect(row.f_title).toBeNull();
        expect(row.f_title_seq).toBeNull();
      } finally {
        after.close();
      }
    } finally {
      await fiber.dispose();
    }
  });

  it("serves the title straight from the session row when no checkpoint row exists", async () => {
    const root = await tempDir("session-title-");
    const dbPath = join(root, "sessions.sqlite");
    const ctx = createCtx();
    const fiber = await mountOnto(ctx, { config: { type: "sqlite", path: dbPath } });
    try {
      const cache = await waitFor(
        () =>
          ctx.get("sessionProjectionCache") as
            | {
                cachedSnapshot(
                  header: SessionHeader,
                  keys?: readonly string[],
                ): { asOfSeq: number; values: Record<string, unknown> } | undefined;
              }
            | undefined,
      );
      const id = SessionId("titled");
      ctx.sessions.create(id, {
        meta: meta("titled"),
        seed: [...oneTurnLog(), titleEvent("直取标题", 6)],
      });
      const live = ctx.sessions.get(id)!;
      await ctx.sessions.flush(live);
      // 标题随写路径刷新进镜像（不再有同步直读）。
      await (cache as unknown as { write(session: unknown): Promise<void> }).write(live);

      const snapshot = cache.cachedSnapshot(live.header, ["title"]);
      expect(snapshot?.values["title"]).toBe("直取标题");
      expect(snapshot?.asOfSeq).toBe(6);
    } finally {
      await fiber.dispose();
    }
  });

  it("extracts titles from current and legacy event shapes", () => {
    expect(titleOfEventData('{"type":"session/title","data":{"title":"当前"}}')).toBe("当前");

    expect(titleOfEventData('{"title":"旧世代","messageSeqs":[1]}')).toBe("旧世代");
    expect(titleOfEventData('{"data":{}}')).toBeUndefined();
    expect(titleOfEventData("not json")).toBeUndefined();
  });
});
