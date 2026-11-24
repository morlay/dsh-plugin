// 从源包搬来的 `session-query.spec.ts`：用例、断言、参数表一律不动，只换 preamble 与 import。
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionQueryRdb, asRdbStore } from "@morlay/session-rdb";
import {
  mount as mountHarness,
  type MountedContext as Context,
  type RowEntry,
} from "../../__tests__/support/base.ts";
import { meta, oneTurnLog } from "@morlay/dsh-session/testing";

async function harness(
  config: Record<string, unknown> = {},
  services?: readonly RowEntry[],
): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const { ctx, dispose } = await mountHarness({
    config: { type: "sqlite", path: ":memory:", ...config } as never,
    ...(services === undefined ? {} : { services }),
  });
  return { ctx, dispose };
}

describe("session-rdb session query replacement", () => {
  test("serves ctx.sessionQuery from the rdb backend", async () => {
    const { ctx, dispose } = await harness();
    onTestFinished(() => dispose());
    expect(ctx.get("sessionQuery")).toBeInstanceOf(SessionQueryRdb);
  });

  test("冷会话观察缓存容量是这一行的配置（默认 1，改了就生效）", async () => {
    // 上游把这个容量藏在 session-query 自己的 config 里（默认 5），本仓库以前没接线：现在由 `session-rdb`
    // 行的 `preparedSessionCacheSize` 透传，默认 1——每个条目持一份完整日志，越小越不放大内存。
    const defaults = await harness();
    onTestFinished(() => defaults.dispose());
    expect((defaults.ctx.sessionQuery as SessionQueryRdb).preparedSessionCacheSize).toBe(1);

    const explicit = await harness({ preparedSessionCacheSize: 3 });
    onTestFinished(() => explicit.dispose());
    expect((explicit.ctx.sessionQuery as SessionQueryRdb).preparedSessionCacheSize).toBe(3);
  });

  test("keeps full-text search disabled without any derived index database", async () => {
    const { ctx, dispose } = await harness();
    onTestFinished(() => dispose());
    const query = ctx.sessionQuery;

    await expect(query.searchSessions({ query: "needle" })).rejects.toMatchObject({
      code: "SESSION_QUERY_SEARCH_DISABLED",
    });
    await expect(
      query.searchEvents({ sessionId: SessionId("missing"), query: "needle" }),
    ).rejects.toMatchObject({
      code: "SESSION_QUERY_SEARCH_DISABLED",
    });
  });

  test("lists live-preferred records through the shared base engine", async () => {
    const { ctx, dispose } = await harness();
    onTestFinished(() => dispose());
    const persistence = ctx.sessionPersistence as unknown as {
      createAndAppend(header: unknown, events: unknown[]): Promise<void>;
    };
    await persistence.createAndAppend(meta("persisted"), oneTurnLog());
    ctx.sessions.create(SessionId("live"), { meta: meta("live"), seed: oneTurnLog() });

    const records = await ctx.sessionQuery.listSessions();
    const byId = new Map(records.map((record) => [String(record.header.id), record]));
    expect([...byId.keys()].sort()).toEqual(["live", "persisted"]);
    expect(byId.get("live")).toMatchObject({ live: true, persisted: false });
    expect(byId.get("persisted")).toMatchObject({ live: false, persisted: true });
  });

  test("excludes archived sessions from the official list", async () => {
    // 归档集合是 workspace 域的**那一份状态**（页面上的归档动作写它）：本行读的是同一份
    // （`archivedSessionIds()` 读 `workspace` 域的 global），所以不注入 workspace 域。
    const { ctx, dispose } = await harness();
    onTestFinished(() => dispose());
    const persistence = ctx.sessionPersistence as unknown as {
      createAndAppend(header: unknown, events: unknown[]): Promise<void>;
    };
    await persistence.createAndAppend(meta("kept"), oneTurnLog());
    await persistence.createAndAppend(meta("archived"), oneTurnLog());
    const repository = await asRdbStore(ctx.sessionPersistence).storageRepository();
    await repository.writeDomainGlobal("workspace", {
      initialized: true,
      workspaceIds: [],
      archivedSessionIds: ["archived"],
      pinnedSessionIds: [],
    });

    const ids = (await ctx.sessionQuery.listSessions()).map((record) => String(record.header.id));

    expect(ids).toEqual(["kept"]);
  });

  test("reads exact events and titles through the shared base engine", async () => {
    const { ctx, dispose } = await harness();
    onTestFinished(() => dispose());
    const persistence = ctx.sessionPersistence as unknown as {
      createAndAppend(header: unknown, events: unknown[]): Promise<void>;
    };
    await persistence.createAndAppend(meta("exact"), oneTurnLog());

    const events = await ctx.sessionQuery.listEvents(SessionId("exact"));
    expect(events.some((event) => event.type === "user/message")).toBe(true);
    const trace = await ctx.sessionQuery.traceSession(SessionId("exact"));
    expect(String(trace.target.header.id)).toBe("exact");
    expect(trace.complete).toBe(true);
  });
});
