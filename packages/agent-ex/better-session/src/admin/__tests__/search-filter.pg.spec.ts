// L4：真 PostgreSQL（TEST_PG_URL 门控）。三条——前缀段的查询计划、结构化过滤的结果、
// 批量删除的逐条结算——在 PG 上也成立。
//
// 日常回归不跑（容器不在时整组 skip）：本包其余用例只覆盖 SQLite，方言差异由 zephyr-rdb 自己守。
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { meta, turnLog } from "@morlay/dsh-session/testing";
import { asRdbStore, openRdbBackend } from "@morlay/better-session";
import { createPostgresTestDatabase } from "@morlay/zephyr-rdb/testing";
import { concat, E, fragment } from "@morlay/zephyr-rdb";
import { describe, expect, it } from "vitest";
import { mount } from "../../__tests__/support/base.ts";
import { sessionRowsCondition, type SessionRowsColumns } from "../../data/store/rows-query.ts";

// 查询计划与 L2 的 SQLite 用例同一组列引用：两边跑的是同一个条件构造器的产物。
const columns: SessionRowsColumns = {
  title: E.column("f_title"),
  origin: E.column("f_origin"),
  archivedAt: E.column("f_archived_at"),
  lastEventAt: E.column("f_last_event_at"),
  createdAt: E.column("f_created_at"),
};

const pgUrl = process.env["TEST_PG_URL"];

// 一条带标题的日志：标题列只从 session/title 事件折出来。
function titledLog(title: string, id: string): SessionEvent[] {
  const log = turnLog(0, 1, { users: [{ id: id + "-u", text: title }] });
  return [
    ...log,
    {
      type: "session/title",
      seq: log.length,
      time: log.length,
      data: { title, messageSeqs: [], source: "auto" },
    } as unknown as SessionEvent,
  ];
}

describe.skipIf(!pgUrl)("L4 PostgreSQL：搜索、过滤与批量删除", () => {
  it("前缀段两边都用不上原列索引：SQLite 整表扫，PG 的 like(lower(f_title)) 也拿不到索引条件（方言差异）", async () => {
    const testDatabase = await createPostgresTestDatabase();
    const mounted = await mount({
      config: { type: "postgres", connectionString: testDatabase.connectionString },
    });
    const planner = await openRdbBackend({
      type: "postgres",
      connectionString: testDatabase.connectionString,
    });
    try {
      const handle = await mounted.persistence.create(meta("pg-indexed"));
      await handle.append(turnLog(0, 1, { users: [{ id: "pg-u", text: "深水区报告" }] }));
      await handle.close();

      // 跑的是产品路径的**同一个条件片段**（SQLite 是 lower(f_title) 的范围比较、PG 是
      // like(lower(f_title), 'x%')），不是另写一条原生 SQL——否则测不到「真的跑在产品上的语句」。
      const condition = sessionRowsCondition(columns, { query: "深水" }, "prefix");
      if (condition === undefined) throw new Error("条件没有构造出来");
      // 对照：原列上的范围比较（旧写法）在同一设置下能拿到 Index Cond——它证明下面那条断言不是空过。
      const control = fragment(
        "EXPLAIN SELECT * FROM t_sessions WHERE f_title >= '深水' AND f_title < '深水zzz'",
      );
      const [rows, controlRows] = await planner.database.transaction(async (tx) => {
        // 关掉顺序扫描：规划器被迫优先考虑索引路径，能用索引就会用。
        await tx.run(fragment("SET LOCAL enable_seqscan = off"));
        return [
          await tx.read<Record<string, string>>(
            concat(["EXPLAIN SELECT * FROM t_sessions WHERE", condition]),
          ),
          await tx.read<Record<string, string>>(control),
        ] as const;
      });
      const planOf = (planRows: readonly Record<string, string>[]) =>
        planRows.map((row) => Object.values(row).join(" ")).join("\n");
      const plan = planOf(rows);
      // 债 20261120「标题前缀搜索用不上 idx_sessions_title」：SQLite 的计划是 SCAN t_sessions，PG 同一条
      // 前缀条件也拿不到 Index Cond（谓词只能落在 Filter 上）。PG 的说法就按这个判：计划里可能仍出现
      // idx_sessions_title 这个名字——那是关掉顺序扫描后的全索引扫读法，不是「前缀段命中索引」。
      expect(plan).toContain("lower(f_title)");
      expect(plan).not.toMatch(/Index Cond/);
      expect(planOf(controlRows)).toMatch(/Index Cond/);
    } finally {
      await planner.close();
      await mounted.dispose();
      await testDatabase.drop();
    }
  });

  it("rows 的两段式搜索与归档过滤在 PG 上给出同样的结果", async () => {
    const testDatabase = await createPostgresTestDatabase();
    const mounted = await mount({
      config: { type: "postgres", connectionString: testDatabase.connectionString },
    });
    const writer = await openRdbBackend({
      type: "postgres",
      connectionString: testDatabase.connectionString,
    });
    try {
      const store = asRdbStore(mounted.persistence);
      const first = await mounted.persistence.create(meta("pg-deep"));
      await first.append(titledLog("深水区报告", "pg-deep"));
      await first.close();
      const second = await mounted.persistence.create(meta("pg-kept"));
      await second.append(titledLog("另一份报告", "pg-kept"));
      await second.close();
      await writer.database.run(
        fragment('UPDATE "t_sessions" SET "f_archived_at" = 1 WHERE "f_session_id" = ?', [
          "pg-deep",
        ]),
      );

      expect((await store.listRows({ query: "深水" })).searchStage).toBe("prefix");
      const contains = await store.listRows({ query: "水区" });
      expect(contains.items.map((row) => row.sessionId)).toEqual(["pg-deep"]);
      expect(contains.searchStage).toBe("contains");
      expect(
        (await store.listRows({ archived: "only" })).items.map((row) => row.sessionId),
      ).toEqual(["pg-deep"]);
      expect(
        (await store.listRows({ archived: "unarchived" })).items.map((row) => row.sessionId),
      ).toEqual(["pg-kept"]);
    } finally {
      await writer.close();
      await mounted.dispose();
      await testDatabase.drop();
    }
  });

  it("bulkDelete 在 PG 上逐条结算，整批不回滚", async () => {
    const testDatabase = await createPostgresTestDatabase();
    const mounted = await mount({
      config: { type: "postgres", connectionString: testDatabase.connectionString },
    });
    const writer = await openRdbBackend({
      type: "postgres",
      connectionString: testDatabase.connectionString,
    });
    try {
      const store = asRdbStore(mounted.persistence);
      for (const id of ["pg-bulk-a", "pg-bulk-b"]) {
        const handle = await mounted.persistence.create(meta(id));
        await handle.append(turnLog(0, 1));
        await handle.close();
      }
      const kept = await mounted.persistence.create(meta("pg-bulk-kept"));
      await kept.append(turnLog(0, 1));
      await kept.close();
      await writer.database.run(
        fragment('UPDATE "t_sessions" SET "f_archived_at" = 1 WHERE "f_session_id" IN (?, ?)', [
          "pg-bulk-a",
          "pg-bulk-b",
        ]),
      );

      const result = await store.bulkDelete(["pg-bulk-a", "pg-bulk-b", "pg-bulk-kept", "absent"]);
      expect(result.items).toEqual([
        { sessionId: "pg-bulk-a", ok: true },
        { sessionId: "pg-bulk-b", ok: true },
        { sessionId: "pg-bulk-kept", ok: false, code: "SESSION_NOT_ARCHIVED" },
        { sessionId: "absent", ok: false, code: "SESSION_NOT_FOUND" },
      ]);
      expect((await store.listRows({ limit: 10 })).items.map((row) => row.sessionId)).toEqual([
        "pg-bulk-kept",
      ]);
    } finally {
      await writer.close();
      await mounted.dispose();
      await testDatabase.drop();
    }
  });

  it("locateEvents 的 LIKE 在 PG 上给出与 SQLite 同样的命中与片段", async () => {
    const testDatabase = await createPostgresTestDatabase();
    const mounted = await mount({
      config: { type: "postgres", connectionString: testDatabase.connectionString },
    });
    try {
      const store = asRdbStore(mounted.persistence);
      const handle = await mounted.persistence.create(meta("pg-locate"));
      await handle.append(turnLog(0, 1, { users: [{ id: "pg-locate-u", text: "深水区报告" }] }));
      await handle.close();

      const hits = await store.locateEvents("pg-locate", { text: "深水区" });

      expect(hits.items.map((item) => item.seq)).toEqual([2, 3]);
      expect(hits.items[0]?.snippet).toContain("深水区");
      expect(hits.total).toBe(2);
      // 窗口边界在 PG 上同样越界即报码。
      await expect(store.locateEvents("pg-locate", { toSeq: 99 })).rejects.toMatchObject({
        code: "SESSION_QUERY_INVALID_WINDOW",
      });
    } finally {
      await mounted.dispose();
      await testDatabase.drop();
    }
  });
});
