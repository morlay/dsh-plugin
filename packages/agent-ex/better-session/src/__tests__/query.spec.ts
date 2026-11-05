// 会话查询（`sessionQuery`）在 RDB 后端上的两条语义差：
// 官方列表默认不含已归档；没有全文索引时搜索是**显式失败**而不是空结果。
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionId, type SessionEvent } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionQuery } from "@morlay/dsh-session";
import { afterEach, describe, expect, it } from "vitest";
import { SessionPersistenceRdb } from "@morlay/better-session";
import { startHarness, type Harness } from "./support/host.ts";
import { meta, oneTurnLogStepFirst, turnLog } from "@morlay/dsh-session/testing";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

async function seed(harness: Harness, id: string): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, "/work"));
  await handle.append(oneTurnLogStepFirst());
  await handle.close();
}

describe("会话查询", () => {
  it("listSessions 列出已落库的会话", async () => {
    const harness = await start();
    await seed(harness, "query-1");
    await seed(harness, "query-2");

    const records = await harness.app.get(SessionQuery).listSessions();

    expect(records.map((record) => String(record.header.id)).sort()).toEqual([
      "query-1",
      "query-2",
    ]);
  });

  it("搜索是显式失败：错误码带 SESSION_QUERY_SEARCH_DISABLED", async () => {
    const harness = await start();
    await seed(harness, "query-search");
    const query = harness.app.get(SessionQuery);

    await expect(query.searchSessions({ query: "你好" } as never)).rejects.toMatchObject({
      code: "SESSION_QUERY_SEARCH_DISABLED",
    });
    await expect(query.searchEvents({ query: "你好" } as never)).rejects.toMatchObject({
      code: "SESSION_QUERY_SEARCH_DISABLED",
    });
  });

  it("readSession 读回完整日志（含 header）", async () => {
    const harness = await start();
    await seed(harness, "query-read");

    const snapshot = await harness.app.get(SessionQuery).readSession(SessionId("query-read"));

    expect(snapshot.events).toHaveLength(6);
    expect(String(snapshot.session.id)).toBe("query-read");
  });

  // 这四条钉住「直接查我们自己的库」这件事：查询行走的是 SessionPersistenceRdb 的读面，
  // 不是上游引擎自带的语料层——所以同一个库里会话/事件/标题/表面都读得到，且 live 优先。
  it("listEvents / readSurface 都从同一个库读出来", async () => {
    const harness = await start();
    await seed(harness, "query-surfaces");
    const query = harness.app.get(SessionQuery);

    const records = await query.listEvents(SessionId("query-surfaces"));
    expect(records.length).toBeGreaterThan(0);
    const seqs = records.map((record) => record.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const surface = await query.readSurface(SessionId("query-surfaces"));
    expect(String(surface.session.id)).toBe("query-surfaces");
    expect(surface.capturedThroughSeq).toBe(records.at(-1)?.seq ?? null);
  });

  it("observeSession 给出不可变切面与可再租借的租约", async () => {
    const harness = await start();
    await seed(harness, "query-observe");
    const query = harness.app.get(SessionQuery);

    using observation = await query.observeSession(SessionId("query-observe"));
    expect(String(observation.header.id)).toBe("query-observe");
    expect(observation.events.length).toBe(6);
    expect(observation.cursor).toBe(observation.events.at(-1)?.seq);
    // 再租借一份：两次 dispose 各自归还。
    using second = observation.retain();
    expect(second.events).toBe(observation.events);
  });

  it("readEvent 给目标事件与前后窗口，越界显式报错", async () => {
    const harness = await start();
    await seed(harness, "query-window");
    const query = harness.app.get(SessionQuery);

    const window = await query.readEvent({
      sessionId: SessionId("query-window"),
      seq: 2 as never,
      before: 1,
      after: 1,
    });
    expect(window.startSeq).toBe(1);
    expect(window.endSeq).toBe(3);
    expect(window.events).toHaveLength(3);
    expect(window.target.seq).toBe(2);

    await expect(
      query.readEvent({ sessionId: SessionId("query-window"), seq: 99 as never }),
    ).rejects.toMatchObject({ code: "SESSION_QUERY_EVENT_NOT_FOUND" });
    await expect(
      query.readEvent({ sessionId: SessionId("query-window"), seq: 0 as never, before: 999 }),
    ).rejects.toMatchObject({ code: "SESSION_QUERY_INVALID_WINDOW" });
  });

  it("traceSession 在 lineage 上认出自己", async () => {
    const harness = await start();
    await seed(harness, "query-trace");
    const trace = await harness.app.get(SessionQuery).traceSession(SessionId("query-trace"));
    expect(String(trace.target.header.id)).toBe("query-trace");
  });
});

// 观测缓存：判据是「同一个 revision 只读一次日志」，所以数的是落盘行的 `load`（读日志的唯一入口）。
function countLoads(harness: Harness): { loads: number } {
  const persistence = harness.app.get(SessionPersistence) as SessionPersistenceRdb;
  const counts = { loads: 0 };
  const original = persistence.load.bind(persistence);
  persistence.load = async (id, signal) => {
    counts.loads += 1;
    return await original(id, signal);
  };
  return counts;
}

describe("观测缓存", () => {
  it("同一 revision 两次 observeSession 只读一次日志", async () => {
    const harness = await start();
    await seed(harness, "query-cache");
    const counts = countLoads(harness);
    const query = harness.app.get(SessionQuery);

    const first = await query.observeSession(SessionId("query-cache"));
    const second = await query.observeSession(SessionId("query-cache"));

    expect(counts.loads).toBe(1);
    expect(second.events).toBe(first.events);
    expect(second.cursor).toBe(first.cursor);
    first[Symbol.dispose]();
    second[Symbol.dispose]();
  });

  // revision 是缓存键的一半：日志前进之后不能再拿旧切面（否则页面永远停在旧水位）。
  it("revision 变了就重读，不返回旧切面", async () => {
    const harness = await start();
    await seed(harness, "query-cache-rev");
    const counts = countLoads(harness);
    const query = harness.app.get(SessionQuery);
    const id = SessionId("query-cache-rev");

    const before = await query.observeSession(id);
    const handle = await harness.app.get(SessionPersistence).open(id, "write");
    await handle.append(turnLog(6, 2));
    await handle.close();
    const after = await query.observeSession(id);

    expect(counts.loads).toBe(2);
    expect(after.events.length).toBeGreaterThan(before.events.length);
    before[Symbol.dispose]();
    after[Symbol.dispose]();
  });

  // 容量默认 1：条目满了按 LRU 淘汰，但**被租约 pin 住的切面不许被踢**——租约活着，切面就得一直有效。
  it("租约 pin 住的条目不被淘汰，归还之后才腾位", async () => {
    const harness = await start();
    await seed(harness, "query-pin-a");
    await seed(harness, "query-pin-b");
    const counts = countLoads(harness);
    const query = harness.app.get(SessionQuery);

    const pinned = await query.observeSession(SessionId("query-pin-a"));
    const other = await query.observeSession(SessionId("query-pin-b"));
    expect(counts.loads).toBe(2);

    // 第二个会话再观测一次：命中缓存，不再读日志。
    const again = await query.observeSession(SessionId("query-pin-b"));
    expect(counts.loads).toBe(2);
    expect(again.events).toBe(other.events);

    // 归还 a 的租约：它的条目这才有资格被淘汰，于是再观测要重读。
    pinned[Symbol.dispose]();
    const reloaded = await query.observeSession(SessionId("query-pin-a"));
    expect(counts.loads).toBe(3);
    expect(String(reloaded.header.id)).toBe("query-pin-a");

    for (const lease of [other, again, reloaded]) lease[Symbol.dispose]();
  });
});

// 一条 seq 连续、surface 全是 append 的长日志（总数取 6 的倍数：一整个回合 6 条事件）。
function bigLog(total: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  let turn = 0;
  while (events.length < total) {
    turn += 1;
    const users = [{ id: "t" + String(turn) + "-u", text: "turn " + String(turn) }];
    events.push(...turnLog(events.length, turn, { users }));
  }
  return events.slice(0, total);
}

describe("查询不下推就等于把整段日志读进内存", () => {
  // 判据两件：条件命中几行就只物化几行；事件列表只取四列坐标（不读 f_data）。
  it("1 万条事件的会话：按 seq 区间筛选只物化命中那几行，事件列表不读 f_data", async () => {
    const harness = await start();
    const total = 10_002;
    const handle = await harness.app.get(SessionPersistence).create(meta("query-big", "/work"));
    await handle.append(bigLog(total));
    await handle.close();

    const persistence = harness.app.get(SessionPersistence) as SessionPersistenceRdb;
    const backend = persistence.backend;
    const materialized: number[] = [];
    const originalSelect = backend.reads.selectEventRows.bind(backend.reads);
    backend.reads.selectEventRows = async (id, condition) => {
      const rows = await originalSelect(id, condition);
      materialized.push(rows.length);
      return rows;
    };

    const query = harness.app.get(SessionQuery);
    const documents = await query.filterEvents(SessionId("query-big"), [
      { kind: "seq", from: 9000, to: 9010 },
    ]);

    // 只物化命中那 11 行（不是 1 万行）。
    expect(materialized).toEqual([11]);
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => document.seq >= 9000 && document.seq <= 9010)).toBe(true);

    // 两态分类必须与全量折叠一致：同一份日志，`listEvents`（四列坐标）与 `readSurface`（真折叠）
    // 算出同一批 current 节点。
    const surface = await query.readSurface(SessionId("query-big"));
    const folded = new Set(surface.events.map((event) => event.seq));
    const records = await query.listEvents(SessionId("query-big"));
    expect(records).toHaveLength(total);
    expect(records[0]?.seq).toBe(0);
    expect(records.at(-1)?.seq).toBe(total - 1);
    expect(
      new Set(records.filter((record) => record.surface === "current").map((r) => r.seq)),
    ).toEqual(folded);
    expect(records.find((record) => record.type === "turn/end")?.surface).toBe("log-only");

    // 探针：把没命中的那些行的 f_data 换成不可解析文本——事件列表若读它，就会在 JSON.parse 处炸。
    const db = new DatabaseSync(join(harness.root, "sessions", "sessions.sqlite"));
    try {
      db.exec("UPDATE t_events SET f_data = 'BROKEN' WHERE f_type = 'turn/end'");
    } finally {
      db.close();
    }
    expect(await query.listEvents(SessionId("query-big"))).toHaveLength(total);
  });
});
