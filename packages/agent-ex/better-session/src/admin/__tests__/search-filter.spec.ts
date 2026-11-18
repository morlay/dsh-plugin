// 会话行查询的判据：两段式搜索顺序、过滤条件进同一个 WHERE、分页夹取（L1，纯函数与 SQL 渲染），
// 以及真装配 + 真库上的前缀段的索引代价、过滤下推与两段式回退（L2）。
import { join } from "node:path";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { meta, oneTurnLog, titleEvent, turnLog, twoTurnLog } from "@morlay/dsh-session/testing";
import { asRdbStore } from "@morlay/better-session";
import { E, render } from "@morlay/zephyr-rdb";
import { afterEach, describe, expect, it } from "vitest";
import {
  pageWindow,
  sessionRowsCondition,
  sessionRowsSearchStages,
  type SessionRowsColumns,
} from "../../data/store/rows-query.ts";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";
import { openInitializedSqlite } from "../../__tests__/support/sqlite.ts";

const columns: SessionRowsColumns = {
  title: E.column("f_title"),
  origin: E.column("f_origin"),
  archivedAt: E.column("f_archived_at"),
  lastEventAt: E.column("f_last_event_at"),
  createdAt: E.column("f_created_at"),
};

function rendered(condition: ReturnType<typeof sessionRowsCondition>) {
  if (condition === undefined) throw new Error("条件没有构造出来");
  return render(condition, "sqlite");
}

describe("L1 会话行查询的条件构造", () => {
  it("两段式匹配顺序：先前缀（范围比较）再全文（LIKE），两段都折过大小写", () => {
    expect(sessionRowsSearchStages("报告")).toEqual(["prefix", "contains"]);
    expect(sessionRowsSearchStages("  ")).toEqual([]);

    const prefix = rendered(sessionRowsCondition(columns, { query: "报告" }, "prefix"));
    expect(prefix.text).toContain('lower("f_title") >=');
    expect(prefix.text).toContain('lower("f_title") <');
    expect(prefix.params).toEqual(["报告", "报告\u{10ffff}"]);

    const contains = rendered(sessionRowsCondition(columns, { query: "报告" }, "contains"));
    expect(contains.text).toContain("LIKE");
    expect(contains.text).toContain("lower");
    expect(contains.params).toEqual(["%报告%"]);
  });

  it("时间 / 来源 / 归档三条件进同一个 WHERE", () => {
    const sql = rendered(
      sessionRowsCondition(columns, {
        updatedAfter: 1_000,
        updatedBefore: 2_000,
        origin: "subagent",
        archived: "only",
      }),
    );

    // 时间口径与列表的 updatedAt 同一列：最后活动时间，没有事件时回落创建时间。
    expect(sql.text).toContain('"f_last_event_at"');
    expect(sql.text).toContain('"f_created_at"');
    expect(sql.text).toContain('"f_origin"');
    expect(sql.text).toContain('"f_archived_at"');
    // 三条件的参数都在同一个条件里（顺序固定：时间 → 来源 → 归档 → 搜索）。
    expect(sql.params).toEqual([1_000, 2_000, "subagent"]);
  });

  it("分页参数：默认一页、上限 200、页码从 0 起", () => {
    expect(pageWindow({})).toEqual({ limit: 20, offset: 0 });
    expect(pageWindow({ limit: 0, offset: -5 })).toEqual({ limit: 20, offset: 0 });
    expect(pageWindow({ limit: 500, offset: 40 })).toEqual({ limit: 200, offset: 40 });
    expect(pageWindow({ limit: 12.5, offset: 1.5 })).toEqual({ limit: 20, offset: 0 });
  });
});

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

// 标题来自第一条用户消息：给每个会话一份不一样的文本，搜索才有区分度。
async function seedTitled(harness: Harness, id: string, title: string): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id));
  const log = turnLog(0, 1, { users: [{ id: id + "-u", text: title }] });
  // 标题是日志里的事件（写路径只从 session/title 折列）：给会话一条，列表才有可搜的 f_title。
  await handle.append([...log, titleEvent(log.length, title)]);
  await handle.close();
}

async function seedLog(harness: Harness, id: string, log: ReturnType<typeof oneTurnLog>) {
  const handle = await harness.app.get(SessionPersistence).create(meta(id));
  await handle.append(log);
  await handle.close();
}

async function openSqlite(harness: Harness) {
  return await openInitializedSqlite(join(harness.root, "sessions", "sessions.sqlite"), "wal");
}

describe("L2 会话行查询（真装配 + 真库）", () => {
  it("前缀段的索引代价：lower(f_title) 用不上原列索引，计划是整表扫（已接受的债）", async () => {
    const harness = await start();
    await seedTitled(harness, "indexed", "深水区报告");
    const sqlite = await openSqlite(harness);
    try {
      const sql = rendered(sessionRowsCondition(columns, { query: "深水" }, "prefix"));
      const plan = sqlite
        .prepare("EXPLAIN QUERY PLAN SELECT * FROM t_sessions WHERE " + sql.text)
        .all(...sql.params.map((value) => String(value))) as Array<{ detail: string }>;
      const details = plan.map((row) => row.detail).join("\n");
      // 前缀段与全文段同一个 lower(f_title) 口径（大小写不敏感是产品口径），代价是 idx_sessions_title
      // 是原列的 BINARY 索引、范围条件比的是折过大小写的列，用不上它。语义优先是已批的决定；
      // 索引优化（表达式索引 / 归一列）另记一笔债——这一条就是那笔债的判据。
      expect(details).toMatch(/SCAN t_sessions/);
      expect(details).not.toContain("idx_sessions_title");
    } finally {
      sqlite.close();
    }
  });

  it("前缀搜不到自动退全文：中段词命中且标出走的哪一段", async () => {
    const harness = await start();
    await seedTitled(harness, "deep-water", "深水区报告");
    const store = asRdbStore(harness.app.get(SessionPersistence));

    const prefix = await store.listRows({ query: "深水" });
    expect(prefix.items.map((item) => item.sessionId)).toEqual(["deep-water"]);
    expect(prefix.searchStage).toBe("prefix");

    const contains = await store.listRows({ query: "水区" });
    expect(contains.items.map((item) => item.sessionId)).toEqual(["deep-water"]);
    expect(contains.searchStage).toBe("contains");
  });

  it("rows 的时间 / 来源 / 归档过滤进 WHERE，三条件是 AND", async () => {
    const harness = await start();
    await seedLog(harness, "newer", twoTurnLog());
    await seedLog(harness, "older", oneTurnLog());
    const sqlite = await openSqlite(harness);
    try {
      sqlite.exec("UPDATE t_sessions SET f_origin = 'subagent' WHERE f_session_id = 'older'");
      sqlite.exec("UPDATE t_sessions SET f_archived_at = 1 WHERE f_session_id = 'newer'");
    } finally {
      sqlite.close();
    }
    const store = asRdbStore(harness.app.get(SessionPersistence));

    expect((await store.listRows({ updatedAfter: 6 })).items.map((row) => row.sessionId)).toEqual([
      "newer",
    ]);
    expect(
      (await store.listRows({ origin: "subagent" })).items.map((row) => row.sessionId),
    ).toEqual(["older"]);
    expect((await store.listRows({ archived: "only" })).items.map((row) => row.sessionId)).toEqual([
      "newer",
    ]);
    expect(
      (await store.listRows({ archived: "unarchived", includeSubagents: true })).items.map(
        (row) => row.sessionId,
      ),
    ).toEqual(["older"]);

    // 三个条件进同一个 WHERE：newer 已归档但不是子代理、older 是子代理但不在时间窗内。
    const combined = await store.listRows({
      updatedAfter: 6,
      origin: "subagent",
      archived: "only",
    });
    expect(combined.total).toBe(0);
  });

  it("rows 的分页参数决定取哪一页，总数是过滤后的总数", async () => {
    const harness = await start();
    await seedLog(harness, "page-a", oneTurnLog());
    await seedLog(harness, "page-b", twoTurnLog());
    await seedLog(harness, "page-c", oneTurnLog());
    const store = asRdbStore(harness.app.get(SessionPersistence));

    const page = await store.listRows({ limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });
});
