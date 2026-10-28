import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SessionPersistenceSqlite from "../index.ts";
import { meta, oneTurnLog } from "../testing.ts";
import { SessionQueryRdb } from "../session-query.ts";

async function harness(
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  new SessionProjectionRegistry(ctx);
  const fiber = await ctx.plugin(SessionPersistenceSqlite, {
    type: "sqlite",
    path: ":memory:",
    ...config,
  });
  return { ctx, dispose: () => fiber.dispose() };
}

describe("session-rdb session query replacement", () => {
  const disposals: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const dispose of disposals.splice(0)) await dispose();
  });

  it("serves ctx.sessionQuery from the rdb backend", async () => {
    const { ctx, dispose } = await harness();
    disposals.push(dispose);
    expect(ctx.get("sessionQuery")).toBeInstanceOf(SessionQueryRdb);
  });

  it("冷会话观察缓存容量是这一行的配置（默认 1，改了就生效）", async () => {
    // 上游把这个容量藏在 session-query 自己的 config 里（默认 5），本仓库以前没接线：现在由 `session-rdb`
    // 行的 `preparedSessionCacheSize` 透传，默认 1——每个条目持一份完整日志，越小越不放大内存。
    const defaults = await harness();
    disposals.push(defaults.dispose);
    expect((defaults.ctx.sessionQuery as SessionQueryRdb).preparedSessionCacheSize).toBe(1);

    const explicit = await harness({ preparedSessionCacheSize: 3 });
    disposals.push(explicit.dispose);
    expect((explicit.ctx.sessionQuery as SessionQueryRdb).preparedSessionCacheSize).toBe(3);
  });

  it("keeps full-text search disabled without any derived index database", async () => {
    const { ctx, dispose } = await harness();
    disposals.push(dispose);
    const query = ctx.sessionQuery;

    await expect(query.searchSessions({ query: "needle" })).rejects.toMatchObject({
      code: "SESSION_QUERY_SEARCH_DISABLED",
    });
    await expect(
      query.searchEvents({ sessionId: SessionId("missing"), query: "needle" }),
    ).rejects.toMatchObject({ code: "SESSION_QUERY_SEARCH_DISABLED" });
  });

  it("lists live-preferred records through the shared base engine", async () => {
    const { ctx, dispose } = await harness();
    disposals.push(dispose);
    const persistence = ctx.sessionPersistence as SessionPersistenceSqlite;
    await persistence.createAndAppend(meta("persisted"), oneTurnLog());
    ctx.sessions.create(SessionId("live"), { meta: meta("live"), seed: oneTurnLog() });

    const records = await ctx.sessionQuery.listSessions();
    const byId = new Map(records.map((record) => [String(record.header.id), record]));
    expect([...byId.keys()].sort()).toEqual(["live", "persisted"]);
    expect(byId.get("live")).toMatchObject({ live: true, persisted: false });
    expect(byId.get("persisted")).toMatchObject({ live: false, persisted: true });
  });

  it("excludes archived sessions from the official list", async () => {
    const { ctx, dispose } = await harness();
    disposals.push(dispose);
    const persistence = ctx.sessionPersistence as SessionPersistenceSqlite;
    await persistence.createAndAppend(meta("kept"), oneTurnLog());
    await persistence.createAndAppend(meta("archived"), oneTurnLog());
    // 归档集合来自 workspace registry（这里最小替身：服务面只有 archivedSessionIds）。
    ctx.provide("workspaceRegistry", {
      archivedSessionIds: [SessionId("archived")],
    } as never);

    const ids = (await ctx.sessionQuery.listSessions()).map((record) => String(record.header.id));

    expect(ids).toEqual(["kept"]);
  });

  it("reads exact events and titles through the shared base engine", async () => {
    const { ctx, dispose } = await harness();
    disposals.push(dispose);
    const persistence = ctx.sessionPersistence as SessionPersistenceSqlite;
    await persistence.createAndAppend(meta("exact"), oneTurnLog());

    const events = await ctx.sessionQuery.listEvents(SessionId("exact"));
    expect(events.some((event) => event.type === "user/message")).toBe(true);
    const trace = await ctx.sessionQuery.traceSession(SessionId("exact"));
    expect(String(trace.target.header.id)).toBe("exact");
    expect(trace.complete).toBe(true);
  });
});
