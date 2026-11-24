// 事件定位与坏会话修复（L2：headless 服务端自闭环，不渲染 UI）。
//
// 为什么留在根 `__tests__/`：它跑整包装配（`support/host.ts` 的 `startHarness`）再造库级坏数据，
// 横跨 admin（定位 / 修法）与 data（行读、事务原语）两个面，不属于任何单一面。
//
// 两条判据：
// - 定位是**行的读**：条件（文本 LIKE / 类型 / 角色 / 时间 / seq 窗口）下推到 SQL，只回命中片段与窗口；
//   即使这份会话的日志读不出来，定位也照样能跑（它不解析整段日志，只扫行）。
// - 修复是**逐会话**的动作：三个修法只碰目标会话，修完目标会话读得出来；别处的坏数据不连坐列表。
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { meta, turnLog } from "@morlay/dsh-session/testing";
import { asRdbStore } from "@morlay/session-rdb";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { startHarness, type Harness } from "./support/host.ts";
import { openInitializedSqlite } from "./support/sqlite.ts";

const closers: Array<() => void> = [];

async function start(): Promise<Harness> {
  const harness = await startHarness();
  onTestFinished(() => harness.dispose());
  return harness;
}

// 一条会话：`turns` 个闭合回合（第 1 回合的用户输入是 `text`，第 2 回合是默认文本）。
async function seed(harness: Harness, id: string, text: string, turns = 1): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, "/work"));
  await handle.append(turnLog(0, 1, { users: [{ id: id + "-u1", text }] }));
  if (turns > 1) await handle.append(turnLog(6, 2));
  await handle.close();
}

// 直接读库的同步口：造「读不出来」的坏数据。
async function openSqlite(harness: Harness): Promise<DatabaseSync> {
  const sqlite = await openInitializedSqlite(
    join(harness.root, "sessions", "sessions.sqlite"),
    "wal",
  );
  closers.push(() => {
    sqlite.close();
  });
  return sqlite;
}

// 把某个 seq 的事件行写坏（JSON 解不出来）：已提交区里的坏行不会被当作撕裂尾部丢掉，读路径直接拒绝。
function corruptEvent(sqlite: DatabaseSync, sessionId: string, seq: number): void {
  sqlite
    .prepare(
      "UPDATE t_events SET f_data = '{' WHERE f_event_id = " +
        "(SELECT f_event_id FROM t_session_events WHERE f_session_id = ? AND f_sequence = ?)",
    )
    .run(sessionId, seq);
}

function archiveSession(sqlite: DatabaseSync, sessionId: string): void {
  sqlite.prepare("UPDATE t_sessions SET f_archived_at = 1 WHERE f_session_id = ?").run(sessionId);
}

function storeOf(harness: Harness) {
  return asRdbStore(harness.app.get(SessionPersistence));
}

describe("事件定位", () => {
  test("只回命中片段：文本 LIKE 扫事件行，类型 / 角色 / 时间各一个条件", async () => {
    const harness = await start();
    await seed(harness, "loc-a", "深水区报告", 2);
    await seed(harness, "loc-b", "别的会话");
    const store = storeOf(harness);

    const hits = await store.locateEvents("loc-a", { text: "深水区" });

    // 用户输入与它的助手回复都含这个词（第 1 回合的 seq 2 / 3）。
    expect(hits.items.map((item) => item.seq)).toEqual([2, 3]);
    expect(hits.total).toBe(2);
    expect(hits.items[0]).toMatchObject({ type: "user/message", role: "user" });
    expect(hits.items[0]?.snippet).toContain("深水区");
    expect(hits.items[1]).toMatchObject({ type: "assistant/message", role: "assistant" });
    // 回的是这次查询的窗口（会话头 head + 1 就是日志长度）。
    expect(hits.window).toEqual({ fromSeq: 0, toSeq: 11 });

    // 名字列是 tool/call 那一类的维度（fixtures 里没有带名字的事件）：直接打在行上看等值条件。
    const sqlite = await openSqlite(harness);
    sqlite
      .prepare(
        "UPDATE t_events SET f_name = 'read' WHERE f_event_id = " +
          "(SELECT f_event_id FROM t_session_events WHERE f_session_id = 'loc-a' AND f_sequence = 3)",
      )
      .run();
    expect(
      (await store.locateEvents("loc-a", { name: "read" })).items.map((item) => item.seq),
    ).toEqual([3]);

    // 类型 / 角色 / 时间各一个条件，都只在本会话里判。
    expect(
      (await store.locateEvents("loc-a", { types: ["assistant/message"] })).items.map(
        (item) => item.seq,
      ),
    ).toEqual([3, 9]);
    expect(
      (await store.locateEvents("loc-a", { role: "user" })).items.map((item) => item.seq),
    ).toEqual([2, 8]);
    // 第 2 回合的事件时间是 6：时间下界把它之外的整段排除。
    expect(
      (await store.locateEvents("loc-a", { fromTime: 1 })).items.map((item) => item.seq),
    ).toEqual([6, 7, 8, 9, 10, 11]);

    // 逐会话隔离：另一个会话里没有这个词。
    expect((await store.locateEvents("loc-b", { text: "深水区" })).items).toEqual([]);
  });

  test("窗口边界：fromSeq / toSeq 收窄取数，limit 只截条数不改总数", async () => {
    const harness = await start();
    await seed(harness, "loc-window", "窗口边界", 2);
    const store = storeOf(harness);

    const tail = await store.locateEvents("loc-window", { fromSeq: 6 });
    expect(tail.items.map((item) => item.seq)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(tail.window).toEqual({ fromSeq: 6, toSeq: 11 });

    const between = await store.locateEvents("loc-window", { fromSeq: 2, toSeq: 3 });
    expect(between.items.map((item) => item.seq)).toEqual([2, 3]);
    expect(between.window).toEqual({ fromSeq: 2, toSeq: 3 });

    const single = await store.locateEvents("loc-window", { fromSeq: 6, toSeq: 6 });
    expect(single.items.map((item) => item.seq)).toEqual([6]);

    const capped = await store.locateEvents("loc-window", { limit: 2 });
    expect(capped.items.map((item) => item.seq)).toEqual([0, 1]);
    expect(capped.total).toBe(12);
  });

  test("越界报错码：窗口超出可读 seq 范围 / 两端颠倒都显式失败，缺会话给 NOT_FOUND", async () => {
    const harness = await start();
    await seed(harness, "loc-oob", "越界", 2);
    const store = storeOf(harness);

    await expect(store.locateEvents("loc-oob", { toSeq: 99 })).rejects.toMatchObject({
      code: "SESSION_QUERY_INVALID_WINDOW",
    });
    await expect(store.locateEvents("loc-oob", { fromSeq: 5, toSeq: 2 })).rejects.toMatchObject({
      code: "SESSION_QUERY_INVALID_WINDOW",
    });
    await expect(store.locateEvents("loc-oob", { fromSeq: -1 })).rejects.toMatchObject({
      code: "SESSION_QUERY_INVALID_WINDOW",
    });
    await expect(store.locateEvents("absent", {})).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  test("读不出来的会话照样定位：定位走行查询，不解析整段日志", async () => {
    const harness = await start();
    await seed(harness, "loc-broken", "坏会话里也有线索", 2);
    const sqlite = await openSqlite(harness);
    corruptEvent(sqlite, "loc-broken", 4);

    // 先决条件：这份会话读不出来。
    await expect(storeOf(harness).load("loc-broken")).rejects.toThrow(/corrupt session log/);

    const hits = await storeOf(harness).locateEvents("loc-broken", { text: "线索" });
    expect(hits.items.map((item) => item.seq)).toEqual([2, 3]);
  });
});

describe("坏会话修复", () => {
  test("drop-tail：只丢最后一个可读边界之后的尾部，修完读得出来，别的会话不动", async () => {
    const harness = await start();
    await seed(harness, "tail-broken", "要丢尾部", 2);
    await seed(harness, "tail-kept", "完好的邻居");
    const sqlite = await openSqlite(harness);
    corruptEvent(sqlite, "tail-broken", 4);
    // 种子会话：继承前缀（6）落在**被丢掉的那段尾部**里。修法必须自己把 seed 收回新日志长度，
    // 否则修完就留下 `seed > 日志长度` —— 那正是体检的 `seed-length-drift`（修法不该自己制造漂移）。
    sqlite
      .prepare("UPDATE t_sessions SET f_seed_length = 6 WHERE f_session_id = 'tail-broken'")
      .run();

    const store = storeOf(harness);
    // 坏数据只影响自己：列表照样把两条都列出来。
    expect((await store.listRows({ limit: 10 })).total).toBe(2);
    await expect(store.load("tail-broken")).rejects.toThrow(/corrupt session log/);

    const result = await store.repairSession("tail-broken", "drop-tail");

    // 可读边界是 seq 4（它自己读不出来）：保留 0..3，丢掉 4..11。
    expect(result).toEqual({
      sessionId: "tail-broken",
      action: "drop-tail",
      keptEvents: 4,
      droppedEvents: 8,
    });
    const repaired = await store.load("tail-broken");
    expect(repaired.events.map((event) => event.seq)).toEqual([0, 1, 2, 3]);
    // 种子段收在 `min(seed, 边界)` 上（不是无脑清零）：6 → 4，且不再超过日志长度。
    expect(repaired.inheritedEventCount).toBe(4);
    expect(repaired.inheritedEventCount).toBeLessThanOrEqual(repaired.events.length);
    // 邻居一个字节都没动。
    expect((await store.load("tail-kept")).events).toHaveLength(6);
  });

  test("rewrite：整段重写（复用 replaceSessionLog），修完读得出来，seed 长度收在日志长度内", async () => {
    const harness = await start();
    await seed(harness, "rewrite-broken", "整段重写", 2);
    await seed(harness, "rewrite-kept", "完好的邻居");
    const sqlite = await openSqlite(harness);
    corruptEvent(sqlite, "rewrite-broken", 4);
    // 另一处漂移：种子长度比日志还长（按继承前缀读不出来）。
    sqlite
      .prepare("UPDATE t_sessions SET f_seed_length = 99 WHERE f_session_id = 'rewrite-broken'")
      .run();

    const store = storeOf(harness);
    await expect(store.load("rewrite-broken")).rejects.toThrow(/corrupt session log/);

    const result = await store.repairSession("rewrite-broken", "rewrite");

    expect(result).toEqual({
      sessionId: "rewrite-broken",
      action: "rewrite",
      keptEvents: 4,
      droppedEvents: 8,
    });
    const repaired = await store.load("rewrite-broken");
    expect(repaired.events.map((event) => event.seq)).toEqual([0, 1, 2, 3]);
    expect(repaired.inheritedEventCount).toBeLessThanOrEqual(repaired.events.length);
    expect((await store.load("rewrite-kept")).events).toHaveLength(6);
  });

  test("运行中的会话不动日志：两个修法都带 SESSION_LIVE（与删除守卫同口径）", async () => {
    const harness = await start();
    const session = harness.sessionStore.create(SessionId("repair-live"), {
      meta: { cwd: "/work" },
    });
    session.append("turn/start", { turn: 1 } as never);
    // 句柄就位、事件已落库，但句柄还开着：这就是「运行中」。
    await harness.sessionStore.flush(session);
    const store = storeOf(harness);

    await expect(store.repairSession("repair-live", "drop-tail")).rejects.toMatchObject({
      code: "SESSION_LIVE",
    });
    await expect(store.repairSession("repair-live", "rewrite")).rejects.toMatchObject({
      code: "SESSION_LIVE",
    });
  });

  test("delete：走现有删除守卫（未归档拒绝、归档后删掉），别的会话不动", async () => {
    const harness = await start();
    await seed(harness, "delete-broken", "删掉坏的", 2);
    await seed(harness, "delete-kept", "完好的邻居");
    const sqlite = await openSqlite(harness);
    corruptEvent(sqlite, "delete-broken", 4);

    const store = storeOf(harness);
    await expect(store.repairSession("delete-broken", "delete")).rejects.toMatchObject({
      code: "SESSION_NOT_ARCHIVED",
    });
    await expect(store.repairSession("absent", "delete")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
    // 未知修法不落到「什么都没做」。
    await expect(store.repairSession("delete-broken", "no-such-action" as never)).rejects.toThrow(
      /unsupported repair action/,
    );

    archiveSession(sqlite, "delete-broken");
    const result = await store.repairSession("delete-broken", "delete");

    expect(result).toEqual({
      sessionId: "delete-broken",
      action: "delete",
      keptEvents: 0,
      droppedEvents: 12,
    });
    const page = await store.listRows({ limit: 10 });
    expect(page.items.map((row) => row.sessionId)).toEqual(["delete-kept"]);
    expect((await store.load("delete-kept")).events).toHaveLength(6);
  });
});
