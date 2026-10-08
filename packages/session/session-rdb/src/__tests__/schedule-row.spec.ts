// 官方 `schedule` 行（`@deepseek-ai/dsh-schedule`）挂在 rdb 存储后端上：本部署把 `storage-domain` 的 backend
// 路由成 `rdb`，所以那个域得有人服务——没人服务时那一行装载即报
// `rdb storage backend serves only the 'workspace' domain (requested 'schedule')`。
// 这里跑一次真装配（真 storage hub + 真域层 + 真 schedule 行 + 真会话库）：建一个提醒 → 落进 `t_schedule_tasks`
// → 换一个进程形（新 ctx、同一个库）读回来。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import Schedule from "@deepseek-ai/dsh-schedule";
import { SessionId } from "@deepseek-ai/dsh-session";
import Storage from "@deepseek-ai/dsh-storage";
import * as StorageDomain from "@deepseek-ai/dsh-storage-domain";
import SessionPersistenceSqlite from "@morlay/session-rdb";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function waitFor<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the service");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// 一次真挂载：会话库（提供 `sessionPersistence` 与 rdb 后端）+ storage hub 与域层 + 官方 schedule 行。
// `sessionController` 只在投递时用（`resolveAgent`），本用例不投递，给一个最小替身。
async function mount(dbPath: string): Promise<Context> {
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Storage);
  await ctx.plugin(StorageDomain, { backend: "rdb" });
  await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: dbPath });
  ctx.provide("sessionController", { resolveAgent: async () => undefined } as never);
  await ctx.plugin(Schedule);
  return ctx;
}

describe("schedule row over the rdb storage backend", () => {
  it("stores the created reminder in the session database and serves it again after a reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "schedule-row-"));
    dirs.push(dir);
    const dbPath = join(dir, "sessions.sqlite");
    const sessionId = SessionId("session-schedule");

    const first = await mount(dbPath);
    let createdId: string;
    try {
      const schedule = await waitFor(() => first.get("schedule") as typeof first.schedule);
      const record = await schedule.create(sessionId, {
        prompt: "该喝水了",
        title: "喝水",
        at: "2030-01-01T00:00:00.000Z",
      });
      createdId = record.id;
      expect((await schedule.list({ sessionId })).map((entry) => entry.id)).toEqual([createdId]);

      const db = new DatabaseSync(dbPath);
      try {
        const rows = db
          .prepare("SELECT f_id, f_session_id, f_status FROM t_schedule_tasks")
          .all() as Array<{ f_id: string; f_session_id: string; f_status: string }>;
        expect(rows).toEqual([
          { f_id: createdId, f_session_id: "session-schedule", f_status: "active" },
        ]);
      } finally {
        db.close();
      }
    } finally {
      await first.fiber.dispose();
    }

    const second = await mount(dbPath);
    try {
      const schedule = await waitFor(() => second.get("schedule") as typeof second.schedule);
      const listed = await schedule.list({ sessionId });
      expect(listed.map((entry) => entry.id)).toEqual([createdId]);
      expect(listed[0]!.title).toBe("喝水");
    } finally {
      await second.fiber.dispose();
    }
  });
});
