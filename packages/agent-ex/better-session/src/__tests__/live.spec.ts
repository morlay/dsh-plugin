// live 会话的写路由：会话内存里追加的事件经四个生命周期事件落到 RDB，`flush` 之后读得到。
//
// 判据是「live 会话 → 存储」这一条链：`SessionStore.create` 建会话、事件追加、flush 屏障之后，持久化读得到。
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./support/host.ts";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

describe("live 会话的写路由", () => {
  it("会话里追加的事件在 flush 之后落到库里", async () => {
    const harness = await start();
    const session = harness.sessionStore.create(SessionId("live-1"), { meta: { cwd: "/work" } });
    session.append("turn/start", { turn: 1 } as never);
    session.append(
      "user/message",
      {
        id: "u-1",
        role: "user",
        content: [{ type: "text", text: "你好" }],
        source: { kind: "user" },
      } as never,
      { surfaceOp: "append" } as never,
    );
    session.append("turn/end", { turn: 1, reason: { kind: "completed" } } as never);

    await harness.sessionStore.flush(session);

    const reader = await harness.app.get(SessionPersistence).open(SessionId("live-1"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events.map((event) => event.type)).toEqual(["turn/start", "user/message", "turn/end"]);
  });

  it("已落库的 live 会话在新实例里读得到（不是进程内状态）", async () => {
    const harness = await start();
    const session = harness.sessionStore.create(SessionId("live-2"), { meta: { cwd: "/work" } });
    session.append("turn/start", { turn: 1 } as never);
    session.append("turn/end", { turn: 1, reason: { kind: "completed" } } as never);
    await harness.sessionStore.flush(session);

    const reopened = await harness.app.get(SessionPersistence).open(SessionId("live-2"), "read");
    const events = (await reopened.read()).events;
    await reopened.close();
    expect(events.map((event) => event.type)).toEqual(["turn/start", "turn/end"]);
  });

  it("多个 live 会话各自 flush 之后都能 stat 到（互不干扰）", async () => {
    const harness = await start();
    const first = harness.sessionStore.create(SessionId("live-3"), { meta: { cwd: "/a" } });
    const second = harness.sessionStore.create(SessionId("live-4"), { meta: { cwd: "/b" } });
    first.append("turn/start", { turn: 1 } as never);
    second.append("turn/start", { turn: 1 } as never);
    await harness.sessionStore.flush(first);
    await harness.sessionStore.flush(second);

    const persistence = harness.app.get(SessionPersistence);
    const a = await persistence.stat(SessionId("live-3"));
    const b = await persistence.stat(SessionId("live-4"));
    expect(a?.header.id).toBe("live-3");
    expect(a?.header.cwd).toBe("/a");
    expect(b?.header.id).toBe("live-4");
    expect(b?.header.cwd).toBe("/b");
  });
});
