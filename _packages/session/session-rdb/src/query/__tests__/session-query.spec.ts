import { afterEach, describe, expect, it } from "vitest";
import { SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import { SessionQueryEngine } from "@deepseek-ai/dsh-session-query";
import type { SessionPersistenceRdb } from "../../index.ts";
import { harness, meta, oneTurnLog } from "../../testing.ts";

describe("session-rdb session query replacement", () => {
  const disposals: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const dispose of disposals.splice(0)) await dispose();
  });

  async function mount(extra: Parameters<typeof harness>[0] = {}) {
    const rdb = await harness(extra);
    disposals.push(() => rdb.app.dispose());
    return rdb;
  }

  it("serves the sessionQuery service from the rdb backend", async () => {
    const rdb = await mount();
    expect(rdb.ctx.get("sessionQuery")).toBeInstanceOf(SessionQueryEngine);
  });

  it("keeps full-text search disabled without any derived index database", async () => {
    const rdb = await mount();
    const query = rdb.ctx.get("sessionQuery") as SessionQueryEngine;

    await expect(query.searchSessions({ query: "needle" })).rejects.toMatchObject({
      code: "SESSION_QUERY_SEARCH_DISABLED",
    });
    await expect(
      query.searchEvents({ sessionId: SessionId("missing"), query: "needle" }),
    ).rejects.toMatchObject({ code: "SESSION_QUERY_SEARCH_DISABLED" });
  });

  it("lists live-preferred records through the shared base engine", async () => {
    const rdb = await mount();
    await rdb.persistence.createAndAppend(meta("persisted"), oneTurnLog());
    rdb.sessions.create(SessionId("live"), { meta: meta("live"), seed: oneTurnLog() });

    const records = await (
      rdb.ctx.get("sessionQuery") as SessionQueryEngine
    ).listSessions();
    const byId = new Map(records.map((record) => [String(record.header.id), record]));
    expect([...byId.keys()].sort()).toEqual(["live", "persisted"]);
    expect(byId.get("live")).toMatchObject({ live: true, persisted: false });
    expect(byId.get("persisted")).toMatchObject({ live: false, persisted: true });
  });

  it("excludes archived sessions from the official list", async () => {
    const rdb = await mount();
    // 归档集合来自 workspace registry（这里最小替身：服务面只有 archivedSessionIds）。
    rdb.ctx.provide("workspaceRegistry", { archivedSessionIds: [SessionId("archived")] } as never);
    await Promise.resolve();
    const persistence = rdb.persistence as SessionPersistenceRdb;
    await persistence.createAndAppend(meta("kept"), oneTurnLog());
    await persistence.createAndAppend(meta("archived"), oneTurnLog());

    const ids = (
      await (rdb.ctx.get("sessionQuery") as SessionQueryEngine).listSessions()
    ).map((record) => String(record.header.id));

    expect(ids).toEqual(["kept"]);
  });

  it("reads exact events and titles through the shared base engine", async () => {
    const rdb = await mount();
    await rdb.persistence.createAndAppend(meta("exact"), oneTurnLog());
    const query = rdb.ctx.get("sessionQuery") as SessionQueryEngine;

    const events = await query.listEvents(SessionId("exact"));
    expect(events.some((event) => event.type === "user/message")).toBe(true);
    const trace = await query.traceSession(SessionId("exact"));
    expect(String(trace.target.header.id)).toBe("exact");
    expect(trace.complete).toBe(true);
  });
});
