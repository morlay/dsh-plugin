// 一致性可发现：派生统计表（t_session_usage / t_session_counts / t_event_usage）与事件行对不上时，
// 校验入口逐类报出来；**只报告不自动修**（重算归 organize），所以同一份漂移查两次结论一样。
import { join } from "node:path";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { meta, oneTurnLogStepFirst } from "@morlay/dsh-session/testing";
import { openDatabase, type Database } from "@morlay/zephyr-rdb";
import type { DatabaseSync } from "node:sqlite";
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { afterEach, describe, expect, it } from "vitest";
import { asRdbStore } from "@morlay/better-session";
import { checkConsistency, repairDerivations } from "../consistency.ts";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";
import { openInitializedSqlite } from "../../__tests__/support/sqlite.ts";

const harnesses: Harness[] = [];
const closers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
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

// 一个带用量的会话：token 与活动计数各有一行（校验两侧都有东西可比）。
async function seedMeasured(harness: Harness, id: string, totalTokens = 100): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, "/work"));
  await handle.append(withUsage(oneTurnLogStepFirst(), totalTokens));
  await handle.close();
}

interface Bench {
  readonly sqlite: DatabaseSync;
  readonly database: Database;
}

// 两个句柄落在同一个库文件上：同步口造漂移，执行面跑校验。
async function openBench(harness: Harness): Promise<Bench> {
  const path = join(harness.root, "sessions", "sessions.sqlite");
  const sqlite = await openInitializedSqlite(path, "wal");
  // 造损坏数据要能写进没有对应事件行的用量行：外键在这一条连接上关掉（只影响测试造数）。
  sqlite.exec("PRAGMA foreign_keys = OFF");
  const database = await openDatabase({
    dialect: "sqlite",
    path,
    journalMode: "wal",
    busyTimeout: 5000,
  });
  closers.push(async () => {
    await database.close();
    sqlite.close();
  });
  return { sqlite, database };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  const row = sqlite.prepare(sql).get() as { n: number };
  return Number(row.n);
}

function kindsOf(report: { issues: ReadonlyArray<{ kind: string }> }): string[] {
  return report.issues.map((issue) => issue.kind).sort();
}

describe("一致性校验", () => {
  it("干净的库：checkConsistency 报 ok，扫描计数与行数一致", async () => {
    const harness = await start();
    await seedMeasured(harness, "clean");
    const { database } = await openBench(harness);

    const report = await checkConsistency(database);

    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    // 6 条事件 / 1 条用量行 / 1 行会话 / 1 行计数：扫过的行数是「真的看了」。
    expect(report.checked).toEqual({
      sessions: 1,
      events: 6,
      bridges: 6,
      usageRows: 1,
      countRows: 1,
    });
  });

  it("派生统计与事件行对不上时逐类报出，且不自动修", async () => {
    const harness = await start();
    await seedMeasured(harness, "drifted");
    await seedMeasured(harness, "seed-broken");
    const { sqlite, database } = await openBench(harness);

    // 一处一类：漏记的 token / 漏记的计数 / 漏掉的引用标记 / 孤儿用量行 / seed 超过日志长度。
    sqlite.exec("DELETE FROM t_session_usage WHERE f_session_id = 'drifted'");
    sqlite.exec("DELETE FROM t_session_counts WHERE f_session_id = 'drifted'");
    sqlite.exec(
      "UPDATE t_event_usage SET f_referenced = 0 WHERE f_event_id IN " +
        "(SELECT f_event_id FROM t_session_events WHERE f_session_id = 'drifted')",
    );
    sqlite.exec("UPDATE t_sessions SET f_seed_length = 99 WHERE f_session_id = 'seed-broken'");
    sqlite.exec(
      "INSERT INTO t_event_usage (" +
        "f_event_id, f_created_at, f_day, f_provider, f_model, f_referenced, f_subagent, " +
        "f_input_tokens, f_output_tokens, f_cache_read_tokens, f_reasoning_tokens, f_total_tokens" +
        ") VALUES ('ghost', 1, '1970-01-01', NULL, NULL, 0, 0, 0, 0, 0, 0, 0)",
    );

    const report = await checkConsistency(database);

    expect(report.ok).toBe(false);
    expect(kindsOf(report)).toEqual([
      "orphan-usage-row",
      "seed-length-drift",
      "session-counts-missing",
      "session-usage-missing",
      "usage-flag-missing",
    ]);
    const usage = report.issues.find((issue) => issue.kind === "session-usage-missing");
    expect(usage?.subject).toBe("drifted");
    expect(usage?.detail).toContain("f_total_tokens 期望 100，实际 0");
    const flags = report.issues.find((issue) => issue.kind === "usage-flag-missing");
    expect(flags?.detail).toContain("f_referenced=0");
    expect(report.issues.find((issue) => issue.kind === "seed-length-drift")?.subject).toBe(
      "seed-broken",
    );

    // 只报告不修：同一份漂移再查一次，结论一样，库里也没被补回来。
    expect(kindsOf(await checkConsistency(database))).toEqual(kindsOf(report));
    expect(
      scalar(sqlite, "SELECT COUNT(*) AS n FROM t_session_usage WHERE f_session_id = 'drifted'"),
    ).toBe(0);
    expect(
      scalar(sqlite, "SELECT COUNT(*) AS n FROM t_session_counts WHERE f_session_id = 'drifted'"),
    ).toBe(0);
  });

  it("契约入口 checkConsistency 与直连执行面同口径", async () => {
    const harness = await start();
    await seedMeasured(harness, "via-contract");
    const { database } = await openBench(harness);

    const viaContract = await asRdbStore(harness.app.get(SessionPersistence)).checkConsistency();
    const direct = await checkConsistency(database);

    expect(viaContract).toEqual(direct);
    expect(viaContract).toMatchObject({ ok: true, checked: { sessions: 1, events: 6 } });
  });

  it("重算失败时把失败的步骤报出来，而不是抛出去", async () => {
    const report = await repairDerivations([
      { step: "session-stats", run: async () => undefined },
      {
        step: "usage-flags",
        run: async () => {
          throw new Error("database is locked");
        },
      },
    ]);

    expect(report.repaired).toBe(false);
    expect(report.failures).toEqual([{ step: "usage-flags", message: "database is locked" }]);
  });
});
