import { Context } from "@deepseek-ai/cordis";
import { SessionId, SessionStore, type SessionEvent } from "@deepseek-ai/dsh-session";
import { describe, expect, it } from "vitest";
import SessionPersistenceSqlite from "@morlay/session-rdb";
import { EmptySettings, meta, oneTurnLog } from "@morlay/session-rdb/testing";

async function mount(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context();
  await ctx.plugin(EmptySettings);
  await ctx.plugin(SessionStore);
  const fiber = await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: ":memory:" });
  return { ctx, dispose: () => fiber.dispose() };
}

interface LogEntry {
  type: string;
  message: string;
}

// ctx.logger 的默认 exporter 阈值是 INFO，这里挂一个收 warn 及以上（含 error）的 exporter。
function captureLogs(ctx: Context): LogEntry[] {
  const entries: LogEntry[] = [];
  ctx.logger.exporter({
    levels: { default: 3 },
    export: (message) => {
      entries.push({ type: String(message.type), message: String(message.args[0]) });
    },
  });
  return entries;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** 先落库一个 cwd=/a 的会话，再用同名不同 cwd 的 live 会话触发 id 冲突（ensureLiveHandle 失败）。 */
async function failingLiveSession(ctx: Context) {
  const handle = await ctx.sessionPersistence.create(meta("s1", "/a"));
  await handle.append(oneTurnLog());
  await handle.close();
  return ctx.sessions.create(SessionId("s1"), { meta: meta("s1", "/b"), seed: [] });
}

describe("live 会话的持久化失败态", () => {
  // 失败后 fail loud：记账一条 error（不再只 warn 一次就算了），事件不再进内存缓冲，
  // flush 把失败抛回上游——原先「聊了一整轮、重启后全丢，内存里还留一份无界副本」的形态消失。
  it("初始化失败后丢弃后续事件并让 flush 报错", async () => {
    const { ctx, dispose } = await mount();
    try {
      const logs = captureLogs(ctx);
      const live = await failingLiveSession(ctx);
      await waitFor(() => logs.some((entry) => entry.type === "error"));

      const error = logs.find((entry) => entry.type === "error");
      expect(error?.message).toContain("will not be persisted");

      ctx.emit("session/event", live, oneTurnLog()[0] as SessionEvent);
      await waitFor(() => logs.some((entry) => entry.message.includes("dropping events")));
      expect(logs.map((entry) => entry.message).join("\n")).toContain("dropping events");

      await expect(ctx.sessions.flush(live)).rejects.toThrow();
    } finally {
      await dispose();
    }
  });
});
