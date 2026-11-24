// 搜索词的大小写口径：词先小写，**前缀段与全文段都拿 lower(f_title) 比**——两段同一口径。
//
// 判据来自一个真实漏检：前缀段原来用原列做范围比较（SQLite 的 BINARY 排序 / PG 的 LIKE），
// 库里 `Report B` 这类首字母大写的标题落不进前缀段；而前缀段一有命中就不再退全文，
// 于是它干脆不出现。这里先锁语义（L1 条件构造 + L2 真装配 + 真库），索引优化是另一笔债。
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { meta, titleEvent, turnLog } from "@morlay/dsh-session/testing";
import { asRdbStore } from "@morlay/session-rdb";
import { E, render } from "@morlay/zephyr-rdb";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { sessionRowsCondition, type SessionRowsColumns } from "../../data/store/rows-query.ts";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";

const columns: SessionRowsColumns = {
  title: E.column("f_title"),
  origin: E.column("f_origin"),
  archivedAt: E.column("f_archived_at"),
  lastEventAt: E.column("f_last_event_at"),
  createdAt: E.column("f_created_at"),
};

function rendered(
  query: string,
  stage: "prefix" | "contains",
  dialect: "sqlite" | "postgres" = "sqlite",
) {
  const condition = sessionRowsCondition(columns, { query }, stage);
  if (condition === undefined) throw new Error("搜索条件没有构造出来");
  return render(condition, dialect);
}

describe("L1 搜索词的大小写口径", () => {
  test("前缀段按 lower(f_title) 范围比较，与全文段同一口径", () => {
    const prefix = rendered("report", "prefix");

    // 比的是折过大小写的列：库里的 Report A / report A 落在同一个区间里。
    expect(prefix.text).toContain('lower("f_title") >=');
    expect(prefix.text).toContain('lower("f_title") <');
    // 词本身在归一阶段小写（与全文段一致）。
    expect(prefix.params).toEqual(["report", "report\u{10ffff}"]);

    const contains = rendered("report", "contains");
    expect(contains.text).toContain("lower");
    expect(contains.params).toEqual(["%report%"]);
  });

  test("大写搜索词归一成小写：REPORT 与 report 渲染出同一份条件", () => {
    const lower = rendered("report", "prefix");
    const upper = rendered("REPORT", "prefix");

    expect(upper.text).toBe(lower.text);
    expect(upper.params).toEqual(lower.params);
  });

  test("PG 前缀段同样是折过大小写的 LIKE（不是原列的 LIKE）", () => {
    const prefix = rendered("report", "prefix", "postgres");

    expect(prefix.text).toContain('lower("f_title") LIKE');
    expect(prefix.params).toEqual(["report%"]);
  });

  test("中文标题不受影响：折大小写对中文是恒等", () => {
    const prefix = rendered("深水", "prefix");

    expect(prefix.params).toEqual(["深水", "深水\u{10ffff}"]);
    expect(rendered("报告", "contains").params).toEqual(["%报告%"]);
  });
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  onTestFinished(() => harness.dispose());
  return harness;
}

// 标题来自 session/title 事件（写路径只从它折 f_title 列），列表才有可搜的文本。
async function seedTitled(harness: Harness, id: string, title: string): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id));
  const log = turnLog(0, 1, { users: [{ id: id + "-u", text: title }] });
  await handle.append([...log, titleEvent(log.length, title)]);
  await handle.close();
}

function idsOf(page: { readonly items: readonly { readonly sessionId: string }[] }): string[] {
  return page.items.map((item) => item.sessionId).sort();
}

describe("L2 大小写不敏感（真装配 + 真库）", () => {
  test("搜 report 同时命中 report A 与大写的 Report B（前缀段有命中也不漏）", async () => {
    const harness = await start();
    await seedTitled(harness, "lower-report", "report A");
    await seedTitled(harness, "upper-report", "Report B");
    const store = asRdbStore(harness.app.get(SessionPersistence));

    const page = await store.listRows({ query: "report" });

    expect(idsOf(page)).toEqual(["lower-report", "upper-report"]);
    expect(page.total).toBe(2);
    expect(page.searchStage).toBe("prefix");
  });

  test("搜 REPORT 与搜 report 给出同一批会话", async () => {
    const harness = await start();
    await seedTitled(harness, "lower-report", "report A");
    await seedTitled(harness, "upper-report", "Report B");
    const store = asRdbStore(harness.app.get(SessionPersistence));

    const page = await store.listRows({ query: "REPORT" });

    expect(idsOf(page)).toEqual(["lower-report", "upper-report"]);
    expect(page.searchStage).toBe("prefix");
  });

  test("中文标题不受影响：前缀仍走前缀段，中段词仍退全文段", async () => {
    const harness = await start();
    await seedTitled(harness, "cjk-deep", "深水区报告");
    const store = asRdbStore(harness.app.get(SessionPersistence));

    const prefix = await store.listRows({ query: "深水" });
    expect(idsOf(prefix)).toEqual(["cjk-deep"]);
    expect(prefix.searchStage).toBe("prefix");

    const contains = await store.listRows({ query: "报告" });
    expect(idsOf(contains)).toEqual(["cjk-deep"]);
    expect(contains.searchStage).toBe("contains");
  });
});
