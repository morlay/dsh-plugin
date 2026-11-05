// @vitest-environment happy-dom
// **分叉的全链路**：动作面 `SessionEditorFace.fork(atSeq)` → 真 wire（`sessionEditor/fork`）→ 真分支行 → 真会话库。
//
// 为什么不经 DOM：分叉的**入口不在用户消息的动作行**上（那是编辑/重试的位置），它在回合末尾那处
// （上游 `TurnTailNodeView` 的 `onBranch`）。本 spec 判的是**分支语义**，所以从动作面直接触发，
// 不依赖某个视图的按钮形状。
//
// 判据全部**读库**：子会话只继承存活前缀、父会话一条不动、两边日志都 balanced（各自能被 token-meter 重放）。
import { Session, SessionId } from "@morlay/dsh-session/contract";
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { TokenMeter } from "@morlay/dsh-session/server";
import { balanceRewindPrefix } from "@morlay/better-session/endpoint";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { startClient } from "../../../__tests__/support/e2e-client.ts";
import { startHost } from "../../../__tests__/support/e2e-host.ts";
import { waitFor } from "../../../__tests__/support/wait.ts";
import { meta, turnLog } from "@morlay/dsh-session/testing";

const opened: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  cleanup();
  for (const item of opened.splice(0).reverse()) await item.dispose();
});

function threeTurnLog() {
  return [...turnLog(0, 1), ...turnLog(6, 2), ...turnLog(12, 3)];
}

const seqsOf = (events: readonly { seq: unknown }[]): number[] =>
  events.map((e) => e.seq as number);

// 配平判据：保留前缀里没有悬空的 step/start（否则紧接着追加 step/start 会报错）。
function balanced(events: Parameters<typeof balanceRewindPrefix>[0]): boolean {
  return balanceRewindPrefix(events).length === events.length;
}

// 能被 token-meter 重放：按存储坐标重建一份日志再折一遍，不该抛。
// 一个装配只装一份 meter（同一服务名注册两次会抛）。
function replays(meter: TokenMeter, id: string, events: readonly SessionEvent[]): void {
  expect(() => meter.measure(Session.create(SessionId(id), [...events]))).not.toThrow();
}

describe("分叉：从某条消息 fork", () => {
  it("子会话只继承存活前缀、父会话不动、两边日志 balanced", { timeout: 90_000 }, async () => {
    const host = await startHost();
    opened.push(host);
    const id = "fork-parent";
    const live = host.ctx.sessions.create(SessionId(id), {
      meta: meta(id, "/work"),
      seed: threeTurnLog(),
    });
    await host.ctx.sessions.flush(live);
    const client = await startClient(host.handlers);
    opened.push(client);

    const before = await host.eventsOf(id);
    // 三个闭合回合（seq 0..17）+ 上游在种子之后补的 `session/end-seed`（seq 18）。
    expect(seqsOf(before)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);

    // 从第二个回合的边界分叉：直接调动作面（真 wire），不经 DOM。
    await client.store.faceOf(id).fork(8);

    // 新会话由服务端铸 id：从库里找出来（排除父会话）。
    const childId = await waitFor(
      () => host.persistence.list(),
      (rows) => rows.some((row) => String(row.header.id) !== id),
      "分叉没有在库里落下子会话",
    ).then((rows) => String(rows.find((row) => String(row.header.id) !== id)?.header.id));
    expect(childId).not.toBe(id);

    // ① 子会话只继承**存活前缀**：分叉点是这条消息所在回合的闭合边界，之后的回合不继承。
    //    （种子 19 条事件里，第三个回合的 6 条留在父会话，子会话没有。）
    const child = await host.eventsOf(childId);
    expect(seqsOf(child)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const childHeader = await host.headerOf(childId);
    expect(childHeader?.isSeeded).toBe(true);

    // ② 父会话一条不动。
    const parent = await host.eventsOf(id);
    expect(seqsOf(parent)).toEqual(seqsOf(before));

    // ③ 两边都 balanced，且各自的日志能被 token-meter 重放。
    expect(balanced(parent)).toBe(true);
    expect(balanced(child)).toBe(true);
    const meter = new TokenMeter(host.ctx as never);
    replays(meter, id, parent);
    replays(meter, childId, child);
  });
});
