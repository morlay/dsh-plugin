// **agent 目录面**的闭环：编辑编排的「先停 agent、再把用户输入排进重放队列」靠 `SessionAgentControl`。
//
// 这条契约在生产里曾经**没有任何实现**（全仓只有 `inject.optional` 的消费点）：于是 `retry` 只截断日志、
// 不重放，界面上就是「点重试没反应」。这里钉住两件事：
//   - 有目录时：`followup` 收到该回合的用户输入，响应的 `queuedTurns` 非 0；
//   - 没目录时：只重写日志，不抛（退化路径仍可用）。
import { SessionId } from "@morlay/dsh-session/contract";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";
import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "./support/wait.ts";
import { startHost, type Host } from "./support/e2e-host.ts";
import { meta, twoTurnLog } from "@morlay/dsh-session/testing";

const opened: Host[] = [];

afterEach(async () => {
  for (const host of opened.splice(0).reverse()) await host.dispose();
});

interface EditorValue {
  readonly sessionId: string;
  readonly queuedTurns: number;
}

function valueOf<T>(result: unknown): T {
  const shaped = result as RemoteResultWire<T>;
  if (!shaped.ok) throw new Error(`端点失败：${shaped.error.code} ${shaped.error.message}`);
  return shaped.value;
}

const seqsOf = (events: readonly { seq: unknown }[]): number[] =>
  events.map((e) => e.seq as number);

// 一条消息的第一个文本块（可选链只到终点，不做「取到就继续访问」）。
function firstTextOf(content: readonly unknown[] | undefined): string | undefined {
  const block = content?.[0] as { text?: string } | undefined;
  return block?.text;
}

// 同一个种子：两个闭合回合。
async function seed(host: Host, id: string): Promise<void> {
  const live = host.ctx.sessions.create(SessionId(id), {
    meta: meta(id, "/work"),
    seed: twoTurnLog(),
  });
  await host.ctx.sessions.flush(live);
  host.agentDirectory.attach(live);
}

describe("SessionAgentControl：agent 目录面", () => {
  it(
    "有目录：retry 把用户输入排进队列（queuedTurns 非 0）并先停 agent",
    { timeout: 60_000 },
    async () => {
      const host = await startHost();
      opened.push(host);
      await seed(host, "retry-live");

      const result = await host.handlers.invoke("sessionEditor/retry", {
        request: { sessionId: "retry-live", turn: 2, cascade: "truncate" },
      });

      // 目录里认得出这个会话 → 队列非 0（之前恒为 0，回复不再生成）。
      expect(valueOf<EditorValue>(result).queuedTurns).toBe(1);
      const queued = host.agentDirectory.followups;
      expect(queued).toHaveLength(1);
      const queuedInput = queued[0];
      expect(
        firstTextOf(
          queuedInput === undefined ? undefined : (queuedInput.content as readonly unknown[]),
        ),
      ).toBe("second turn");
      expect(host.agentDirectory.cancels.map((entry) => entry.id)).toEqual([
        SessionId("retry-live"),
      ]);
      // 重放真的落库：日志重新长出第二个回合。
      const after = await waitFor(
        () => host.eventsOf("retry-live"),
        (events) => events.length === 12 && events.at(-1)?.type === "turn/end",
        "重放没有落进库",
      );
      expect(seqsOf(after)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    },
  );

  it("没目录：retry 只重写日志、不抛（退化路径）", { timeout: 60_000 }, async () => {
    const host = await startHost({ withoutAgents: true });
    opened.push(host);
    // 没有目录面就没有「正在跑的 agent」：这里只验日志被重写、调用不失败。
    const live = host.ctx.sessions.create(SessionId("retry-cold"), {
      meta: meta("retry-cold", "/work"),
      // 没有目录时先要过「有没有可解析的模型配置」这一关，种子得带上请求头。
      seed: [
        ...twoTurnLog(),
        {
          type: "request/header",
          seq: 12,
          time: 12,
          data: { header: { config: { provider: "mock", model: "mock" } }, reason: "initial" },
        } as never,
      ],
    });
    await host.ctx.sessions.flush(live);

    const result = await host.handlers.invoke("sessionEditor/retry", {
      request: { sessionId: "retry-cold", turn: 2, cascade: "truncate" },
    });

    expect(valueOf<EditorValue>(result).queuedTurns).toBe(0);
    await waitFor(
      () => host.eventsOf("retry-cold"),
      (events) => events.length === 6,
      "没有目录时日志也没有被重写",
    );
    expect(host.agentDirectory.followups).toHaveLength(0);
  });
});
