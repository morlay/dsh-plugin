// live 会话与冷会话的读面分流：同一份「尾部未闭合」的日志，live 读出来是**正在跑的轮次**，冷读才是中断。
//
// 三条判据：
//   1. live 中断轮：`readSession` / `observeSession` 不补合成 closer，`cursor` 不超过库 head；
//   2. 冷读仍然配平（上游 `corpus.load` / `readColdSessionLog` 的口径）；
//   3. 含 `image/offload` 投影事件的会话：构造 detached 会话时拿得到注册表里的消息解释器
//      （缺它 `Session.create` 抛裸 Error）。
import { SessionQuery } from "@morlay/dsh-session";
import { SessionId, type SessionEvent } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { asRdbStore } from "@morlay/session-rdb";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";
import { appendLog, meta, turnLog } from "@morlay/dsh-session/testing";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

// 一个回合的五条事件，**没有 turn/end**：turn/start → step/start → user/message → assistant/message → step/end。
function openTurnLog(): SessionEvent[] {
  return turnLog(0, 1, { closed: false });
}

// 上游配平只在内存里补这一种形状的 closer：`turn/end { reason: interrupted }`。
function isInterruptedCloser(event: SessionEvent): boolean {
  return (
    event.type === "turn/end" &&
    (event.data as { reason?: { kind?: string } }).reason?.kind === "interrupted"
  );
}

// 库里那份日志（不经查询面：读路径的修复与格式转换都在它里面）。
async function storedEvents(harness: Harness, id: string): Promise<readonly SessionEvent[]> {
  const store = asRdbStore(harness.app.get(SessionPersistence));
  return (await store.load(id)).events;
}

describe("live 会话的读面", () => {
  it("live 中断轮：readSession / observeSession 不补合成 closer，cursor 不超过库 head", async () => {
    const harness = await start();
    const id = SessionId("live-open-turn");
    const live = harness.sessionStore.create(id, { meta: meta("live-open-turn", "/work") });
    appendLog(live, openTurnLog());
    // live 的落库同步点是 `session/flush`：这之后库里的日志等于内存里的日志。
    await harness.sessionStore.flush(live);

    const stored = await storedEvents(harness, "live-open-turn");
    expect(stored.at(-1)?.type, "先决条件：库里这份日志的轮次是开着的").toBe("step/end");

    const query = harness.app.get(SessionQuery);
    const snapshot = await query.readSession(id);
    expect(snapshot.events, "正在跑的轮次不能被读成已闭合").toHaveLength(stored.length);
    expect(snapshot.events.filter(isInterruptedCloser)).toEqual([]);

    using observation = await query.observeSession(id);
    expect(observation.source).toBe("live");
    expect(observation.events.filter(isInterruptedCloser)).toEqual([]);
    // cursor 是最后一条**库里**事件的 seq：合成 closer 不进切面，也不抬 cursor。
    expect(observation.cursor).toBe(stored.at(-1)?.seq ?? -1);
  });

  it("冷会话的同一份日志仍然配平：合成 closer 进读结果，cursor 因此可以越过库 head", async () => {
    const harness = await start();
    const handle = await harness.app
      .get(SessionPersistence)
      .create(meta("cold-open-turn", "/work"));
    await handle.append(openTurnLog());
    await handle.close();

    const stored = await storedEvents(harness, "cold-open-turn");
    expect(stored.at(-1)?.type, "先决条件：库里这份日志的轮次是开着的").toBe("step/end");

    const query = harness.app.get(SessionQuery);
    const snapshot = await query.readSession(SessionId("cold-open-turn"));
    expect(snapshot.events).toHaveLength(stored.length + 1);
    expect(isInterruptedCloser(snapshot.events.at(-1)!)).toBe(true);

    using observation = await query.observeSession(SessionId("cold-open-turn"));
    expect(observation.source).toBe("prepared");
    expect(isInterruptedCloser(observation.events.at(-1)!)).toBe(true);
    expect(observation.cursor).toBe(observation.events.at(-1)?.seq);
    expect(observation.cursor).toBeGreaterThan(stored.at(-1)?.seq ?? -1);
  });
});

describe("含消息投影事件的会话", () => {
  it("observeSession 用注册表里的消息解释器建 detached 会话，不抛裸 Error", async () => {
    const harness = await start();
    // `image/offload` 是「必须有解释器」的事件类型：解释器由插件注册在会话存储上。
    // 这里只给投影的最小替身（纯函数、不改 surface 节点），判据是构造不再缺解释器。
    const projection = { type: "image/offload", project: () => new Map() };
    harness.sessionStore.registerMessageProjection(projection as never);

    const id = SessionId("projected-images");
    const live = harness.sessionStore.create(id, { meta: meta("projected-images", "/work") });
    appendLog(live, turnLog(0, 1));
    // 第 3 条事件是 user/message（`turnLog` 的形状：turn/start、step/start、user/message…）。
    (live as unknown as { append(type: string, data: unknown): unknown }).append("image/offload", {
      targets: [{ seq: 2, imageIndexes: [0] }],
    });
    await harness.sessionStore.flush(live);

    const query = harness.app.get(SessionQuery);
    // 观测切面要折投影：没有解释器时 `Session.create` 在这里抛「requires a message projection」。
    using observation = await query.observeSession(id);
    expect(observation.events).toHaveLength(7);
    expect(observation.projections).toBeDefined();
  });
});
