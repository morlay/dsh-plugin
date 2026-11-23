// 管理面的非 wire 行为：整理（回收孤儿 + 重算统计 + VACUUM）、归档标记、删除的三条拒绝理由，
// 以及整理 / 删除 / flush 三个动作的可观测结果（停写不变量、重算报告、真屏障）。
import { join } from "node:path";
import { SessionId, type SessionEvent } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { meta, oneTurnLogStepFirst } from "@morlay/dsh-session/testing";
import { asRdbStore, SessionPersistenceRdb } from "@morlay/session-rdb";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";
import { openInitializedSqlite } from "../../__tests__/support/sqlite.ts";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

async function seed(harness: Harness, id: string, cwd?: string): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, cwd));
  await handle.append(oneTurnLogStepFirst());
  await handle.close();
}

// 给助手消息补上 usage：token 统计（t_event_usage / t_session_usage）的输入就是它。
function withUsage(events: readonly SessionEvent[], totalTokens: number): SessionEvent[] {
  return events.map((event) => {
    if (event.type !== "assistant/message") return event;
    const raw = event as unknown as { data: Record<string, unknown> };
    return {
      ...raw,
      data: {
        ...raw.data,
        usage: {
          inputTokens: totalTokens - 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          totalTokens,
        },
      },
    } as unknown as SessionEvent;
  });
}

// 一个带用量的会话：token 与活动计数都有一行（统计表的重算有东西可比）。
async function seedMeasured(harness: Harness, id: string, totalTokens = 100): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, "/work"));
  await handle.append(withUsage(oneTurnLogStepFirst(), totalTokens));
  await handle.close();
}

// 直接读库的同步口：造「只有整理能修」的差异、打归档标记。
async function openSqlite(harness: Harness) {
  const path = join(harness.root, "sessions", "sessions.sqlite");
  return await openInitializedSqlite(path, "wal");
}

function countRows(sqlite: { prepare(sql: string): { get(): unknown } }, table: string): number {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get() as { n: number };
  return Number(row.n);
}

describe("管理面", () => {
  it("organize 回收孤儿并重算派生统计，返回三项计数", async () => {
    const harness = await start();
    await seed(harness, "org-1");
    await seed(harness, "org-2");

    const report = await asRdbStore(harness.app.get(SessionPersistence)).organize();

    expect(report.rebuiltSessions).toBe(2);
    expect(report.orphanSessions).toBe(0);
    expect(Number.isSafeInteger(report.orphanEvents)).toBe(true);
  });

  it("organize 在还有写句柄的会话时拒绝清表（SESSION_ORGANIZE_LIVE），统计没被动过", async () => {
    const harness = await start();
    const persistence = asRdbStore(harness.app.get(SessionPersistence));
    const session = harness.sessionStore.create(SessionId("busy"), { meta: { cwd: "/work" } });
    session.append("turn/start", { turn: 1 } as never);
    // 句柄就位、事件落库，但句柄还开着：这就是「运行中」。
    await harness.sessionStore.flush(session);

    // 先制造一处只有整理会修的差异：把统计行删掉（累加漏记的形态）。
    const sqlite = await openSqlite(harness);
    try {
      sqlite.exec("DELETE FROM t_session_counts");

      await expect(persistence.organize()).rejects.toMatchObject({ code: "SESSION_ORGANIZE_LIVE" });

      // 清表与重算都没发生：差异还在（整理会把它补回来）。
      expect(countRows(sqlite, "t_session_counts")).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("删除只允许已归档且不在运行中的会话，三条拒绝理由各自有码", async () => {
    const harness = await start();
    await seed(harness, "delete-me");
    const persistence = asRdbStore(harness.app.get(SessionPersistence));

    // 未归档。
    await expect(persistence.deleteSession("delete-me")).rejects.toMatchObject({
      code: "SESSION_NOT_ARCHIVED",
    });
    // 不存在。
    await expect(persistence.deleteSession("absent")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  it("删除会话报出派生状态的重算结果（统计行与用量引用标记两步都完成）", async () => {
    const harness = await start();
    const store = harness.app.get(SessionPersistence) as unknown as SessionPersistenceRdb;
    await seedMeasured(harness, "deletable");
    // 删除只允许归档过的会话：这一层没有归档服务，直接打标记。
    const sqlite = await openSqlite(harness);
    try {
      sqlite.exec("UPDATE t_sessions SET f_archived_at = 1 WHERE f_session_id = 'deletable'");
    } finally {
      sqlite.close();
    }
    // 删之前那份消耗计入总览（用量行被这条会话引用着）。
    expect((await asRdbStore(store).usageReport()).totals["totalTokens"]).toBe(100);

    const report = await store.deleteSessionWithRepair("deletable");

    expect(report.sessionId).toBe("deletable");
    expect(report.repair).toEqual({ repaired: true, failures: [] });
    // 引用标记真的重算过：会话没了，那批事件行还在（等孤儿回收），但不再计入总览。
    expect((await asRdbStore(store).usageReport()).totals["totalTokens"]).toBe(0);
  });

  it("bulkDelete 逐条结算（已归档 / 运行中 / 未归档 / 不存在各自有码），并把成功删除的统计重算", async () => {
    const harness = await start();
    const store = harness.app.get(SessionPersistence) as unknown as SessionPersistenceRdb;
    await seedMeasured(harness, "bulk-a", 100);
    await seedMeasured(harness, "bulk-b", 200);
    await seed(harness, "bulk-unarchived");
    // 运行中：写句柄还开着（flush 之后库里已有行，但句柄没关）。
    const live = harness.sessionStore.create(SessionId("bulk-live"), { meta: { cwd: "/work" } });
    live.append("turn/start", { turn: 1 } as never);
    await harness.sessionStore.flush(live);

    const sqlite = await openSqlite(harness);
    try {
      sqlite.exec(
        "UPDATE t_sessions SET f_archived_at = 1 WHERE f_session_id IN ('bulk-a', 'bulk-b', 'bulk-live')",
      );
    } finally {
      sqlite.close();
    }
    expect((await asRdbStore(store).usageReport()).totals["totalTokens"]).toBe(300);

    const result = await store.bulkDelete([
      "bulk-a",
      "bulk-b",
      "bulk-live",
      "bulk-unarchived",
      "absent",
    ]);

    expect(result.items).toEqual([
      { sessionId: "bulk-a", ok: true },
      { sessionId: "bulk-b", ok: true },
      { sessionId: "bulk-live", ok: false, code: "SESSION_LIVE" },
      { sessionId: "bulk-unarchived", ok: false, code: "SESSION_NOT_ARCHIVED" },
      { sessionId: "absent", ok: false, code: "SESSION_NOT_FOUND" },
    ]);
    // 整批不回滚：成功的两条删掉了，失败的还在列表里。
    expect((await asRdbStore(store).usageReport()).totals["totalTokens"]).toBe(0);
    const page = await asRdbStore(store).listRows({ limit: 10 });
    expect(page.items.map((row) => row.sessionId).sort()).toEqual(["bulk-live", "bulk-unarchived"]);
    // 统计行跟着删除清掉；用量引用标记重算后不再计入总览（上面已经断言）。
    const check = await openSqlite(harness);
    try {
      const row = check
        .prepare(
          "SELECT COUNT(*) AS n FROM t_session_counts WHERE f_session_id IN ('bulk-a', 'bulk-b')",
        )
        .get() as { n: number };
      expect(Number(row.n)).toBe(0);
    } finally {
      check.close();
    }
  });

  it("archivedSessionIds 读持久化里的归档标记（没有归档服务时给空集）", async () => {
    const harness = await start();
    await seed(harness, "archive-1");

    const archived = await asRdbStore(harness.app.get(SessionPersistence)).archivedSessionIds();

    expect(archived.size).toBe(0);
  });

  it("listRows 给完整语料（含 cwd / 时间 / 归档标记）并支持分页", async () => {
    const harness = await start();
    await seed(harness, "rows-1", "/work");
    await seed(harness, "rows-2", "/other");

    const page = await asRdbStore(harness.app.get(SessionPersistence)).listRows({
      limit: 1,
      offset: 0,
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ cwd: expect.any(String), archived: false });
  });

  it("flush 之后库里能看到 live 会话的全部事件（写句柄还没建好也不漏）", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);
    const session = harness.sessionStore.create(SessionId("flush-live"), {
      meta: { cwd: "/work" },
    });
    // 写句柄要等一次库读才建好：这两条先落在 live 路由的缓冲里（此刻没有句柄可 flush）。
    session.append("turn/start", { turn: 1 } as never);
    session.append("turn/end", { turn: 1, reason: { kind: "completed" } } as never);

    await persistence.flush();

    const reader = await persistence.open(SessionId("flush-live"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events.map((event) => event.type)).toEqual(["turn/start", "turn/end"]);
  });

  it("flush 把失败态会话的失败报出来（域码 + AggregateError 里的原因）", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);
    // 先按 cwd=/a 落一份，再用同名 cwd=/b 的 live 会话触发 id 冲突：这个会话的持久化是终态失败。
    await seed(harness, "broken", "/a");
    const session = harness.sessionStore.create(SessionId("broken"), { meta: { cwd: "/b" } });
    // 这一条会等句柄创建失败（失败态在这里定下来）。
    await expect(harness.sessionStore.flush(session)).rejects.toThrow(/different cwd/);

    const failure = await persistence.flush().catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "SESSION_FLUSH_FAILED" });
    const causes = (failure as { cause?: unknown }).cause;
    expect(causes).toBeInstanceOf(AggregateError);
    expect((causes as AggregateError).errors.map(String).join("\n")).toMatch(/different cwd/);
  });
});
