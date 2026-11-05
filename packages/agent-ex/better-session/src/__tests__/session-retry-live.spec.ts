// 「点重试 → 进程退出」的回归：真 agent loop + 真库下走 `sessionEditor/retry` 的 wire 路径。
//
// 判据三条：① 进程不退（没有未捕获拒绝，Node 默认会因此退出）；② 日志被截断（被重试那一轮的旧回复不再在库里）；
// ③ 队列收到输入（`queuedTurns` 非 0）。
//
// 为什么用假模型：真模型要 key、且回复不可复现；这里要的是**真 agent loop + 真库**那条链，模型内容无关。
// 装配走 `support/host.ts` 的 `startHarnessWithAgent()`：它与整包装配同一份清单，只是多挂 agent 行。
import { type StreamChunk, type UserMessage } from "@morlay/dsh-agent";
import { LlmAdapter } from "@morlay/dsh-agent/server";
import { MessageId } from "@morlay/dsh-agent/contract";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { startHarnessWithAgent, type HarnessWithAgent } from "./support/host.ts";

/** 假模型：一次性吐一句话，并报一次用量（token-meter 的折叠要真数据）。 */
class FakeAdapter extends LlmAdapter {
  calls = 0;

  async *stream(): AsyncIterable<StreamChunk> {
    this.calls += 1;
    const text = `reply ${String(this.calls)}`;
    yield { type: "block-start", index: 0, blockType: "text" };
    // 流式增量与块收尾都要给：只给 block-end 时消息正文是空的，落库的 assistant/message 就没有这句话。
    yield { type: "text-delta", index: 0, text };
    yield { type: "block-end", index: 0, block: { type: "text", text } };
    yield { type: "usage", usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

const opened: HarnessWithAgent[] = [];
const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};

afterEach(async () => {
  process.off("unhandledRejection", onRejection);
  for (const harness of opened.splice(0).reverse()) await harness.dispose().catch(() => {});
}, 60_000);

/** 起一份带 agent 行的整包装配。 */
async function boot(): Promise<HarnessWithAgent> {
  const harness = await startHarnessWithAgent();
  opened.push(harness);
  return harness;
}

/** 库里那份日志的纯文本视图（判据只看文本与类型，不看内部坐标）。 */
async function logTexts(harness: HarnessWithAgent, sessionId: string): Promise<string[]> {
  const handle = await harness.app.get(SessionPersistence).open(SessionId(sessionId), "read");
  try {
    const read = await handle.read(0, undefined);
    return read.events.map((event) => JSON.stringify(event.data));
  } finally {
    await handle.close();
  }
}

function send(agent: { send: (...args: never[]) => unknown }, id: string, text: string): void {
  (agent.send as unknown as (m: UserMessage, mode: string, kick: boolean) => void)(
    {
      id: MessageId(id),
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    },
    "next-turn",
    true,
  );
}

describe("重试在真 agent 下", { timeout: 180_000 }, () => {
  it("有存活 agent 时点 retry：进程不退、日志被截断、队列收到输入", async () => {
    process.on("unhandledRejection", onRejection);
    const harness = await boot();
    // 假模型走 testkit 装好的上游 Llm（服务名 `llm`）：注册一个只在这里存在的 provider 名，不撞真实适配器。
    (
      harness.app.ctx.get("llm", false) as {
        registerAdapter(p: readonly string[], a: unknown): void;
      }
    ).registerAdapter(["mockp"], new FakeAdapter());
    const sessionId = String(harness.app.get(SessionStore).prepare().id);
    const agent = (await harness.agent.create(
      SessionId(sessionId),
      { provider: "mockp", model: "mockp" },
      { cwd: harness.root },
    )) as unknown as {
      session: unknown;
      send: (...args: never[]) => unknown;
      whenIdle(): Promise<void>;
    };

    // 两个真回合：第二轮就是要被重试的那一轮。
    send(agent, "t1", "第一轮");
    await agent.whenIdle();
    send(agent, "t2", "第二轮");
    await agent.whenIdle();
    // live 会话的落库是批量窗口：读库前先排空，否则看到的是上一批。
    await harness.app.get(SessionStore).flush(agent.session as never);
    const before = await logTexts(harness, sessionId);
    const dropped = before.filter((text) => text.includes('"role":"assistant"')).at(-1);
    expect(dropped, "先决条件：第二轮要有落库的助手回复").toBeDefined();

    const result = await harness.app.get(RemoteHandlers).invoke("sessionEditor/retry", {
      request: { sessionId, turn: 2, cascade: "truncate" },
    });
    await harness.app.get(SessionStore).flush(agent.session as never);

    // ③ 队列收到输入。
    expect(result, `retry 失败：${JSON.stringify(result)}`).toMatchObject({
      ok: true,
      value: { queuedTurns: 1, live: true },
    });
    // ② 被重试那一轮的旧回复已经从库里消失（截断生效）。
    expect(await logTexts(harness, sessionId), "重试后旧回复必须被截掉").not.toContain(dropped);
    // ① 进程不退：重放那一轮跑完之后也不能留下未捕获的拒绝。
    await agent.whenIdle().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(
      rejections.map((reason) => String(reason)),
      "点重试不能让进程因未捕获拒绝退出",
    ).toEqual([]);
  });
});
