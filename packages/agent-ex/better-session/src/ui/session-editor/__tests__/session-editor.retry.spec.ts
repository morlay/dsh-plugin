// @vitest-environment happy-dom
// **重试的全链路**：happy-dom 里真点「重试此回合」→ 真 wire（`sessionEditor/retry`）→ 真编辑编排 → 真会话库。
//
// 判据全部**读库 / 读 agent 面**：该回合的用户输入被排进重放队列（`followup` 收到它）、旧回复从日志里消失、
// 新回复落在同一回合。换掉的只有模型输出（`AgentDirectoryStub` 的固定回复）。
import { SessionId } from "@morlay/dsh-session/contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { startClient, type Client } from "../../../__tests__/support/e2e-client.ts";
import { MOCK_REPLY_PREFIX, startHost, type Host } from "../../../__tests__/support/e2e-host.ts";
import { nodeOf, renderUserMessage } from "../../../__tests__/support/e2e-render.tsx";
import { waitFor } from "../../../__tests__/support/wait.ts";
import { meta, twoTurnLog } from "@morlay/dsh-session/testing";

const opened: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  cleanup();
  for (const item of opened.splice(0).reverse()) await item.dispose();
});

async function boot(id: string): Promise<{ host: Host; client: Client }> {
  const host = await startHost();
  opened.push(host);
  const live = host.ctx.sessions.create(SessionId(id), {
    meta: meta(id, "/work"),
    seed: twoTurnLog(),
  });
  await host.ctx.sessions.flush(live);
  host.agentDirectory.attach(live);
  const client = await startClient(host.handlers);
  opened.push(client);
  return { host, client };
}

// 一条消息的第一个文本块（可选链只到终点，不做「取到就继续访问」）。
function firstTextOf(content: readonly unknown[] | undefined): string | undefined {
  const block = content?.[0] as { text?: string } | undefined;
  return block?.text;
}

// 库里所有 assistant/message 的 id 与正文：断言「旧回复消失、新回复出现」用它。
function repliesOf(
  events: readonly { type: string; data: unknown }[],
): Array<{ id: string; text: string }> {
  return events.flatMap((event) => {
    if (event.type !== "assistant/message") return [];
    const message = (
      event.data as {
        message: { id: string; content: readonly { text?: string }[] };
      }
    ).message;
    return [{ id: message.id, text: message.content.map((block) => block.text ?? "").join("") }];
  });
}

describe("重试：点重试 → 该回合的用户输入进队列、旧回复消失", () => {
  it(
    "先停 agent、旧回复从日志消失、排队的那条输入被重放成新回复",
    { timeout: 60_000 },
    async () => {
      const { host, client } = await boot("retry-target");
      const before = await host.eventsOf("retry-target");
      expect(repliesOf(before)).toEqual([
        { id: "t1-u1-a", text: "answer to turn 1 input" },
        { id: "t2-u1-a", text: "answer to second turn" },
      ]);

      renderUserMessage({ node: nodeOf(before, 8), face: client.store.faceOf("retry-target") });
      fireEvent.click(screen.getByLabelText("重试此回合"));
      fireEvent.click(screen.getByText("确认重试"));

      // ① 动日志之前先停住正在跑的 agent（否则截断会与在途 turn 抢同一份 log）。
      //    点击是 `void retry(...)`，所以这里等事实到位，不等一个同步副作用。
      const cancels = await waitFor(
        () => host.agentDirectory.cancels,
        (entries) => entries.length === 1,
        "重试前没有先停住正在跑的 agent",
      );
      expect(cancels).toEqual([{ id: SessionId("retry-target"), cause: { kind: "user" } }]);

      // ② 该回合的用户输入被排进重放队列：替身目录收到的就是它（原文克隆）。
      const queued = await waitFor(
        () => host.agentDirectory.followups,
        (followups) => followups.length === 1,
        "重试没有把用户输入排进队列",
      );
      const queuedInput = queued[0];
      expect(
        firstTextOf(
          queuedInput === undefined ? undefined : (queuedInput.content as readonly unknown[]),
        ),
      ).toBe("second turn");

      // ③ 旧回复从日志里消失、新回复由（替身）模型写在同一个回合上——读库。
      const after = await waitFor(
        () => host.eventsOf("retry-target"),
        (events) =>
          events.length === 12 &&
          events.at(-1)?.type === "turn/end" &&
          repliesOf(events).every((reply) => !reply.id.startsWith("t2-")),
        "重试后旧回复仍在日志里",
      );
      const replies = repliesOf(after);
      expect(replies.map((reply) => reply.id)).not.toContain("t2-u1-a");
      expect(replies.at(-1)?.text).toBe(MOCK_REPLY_PREFIX + "second turn");
      // 第一个回合原样保留。
      expect(replies[0]).toEqual({ id: "t1-u1-a", text: "answer to turn 1 input" });
    },
  );
});
