/**
 * checkpoint 策略的真装配：真会话/投影/agent 循环 + 真 `session-checkpoint-policy` 插件，
 * 我们的行只负责把上游声明的四个依赖（llm/sessionPersistence/sessions/tools）接上。
 *
 * 策略没有可调用 API，行为只发生在边界上：每次模型请求、工具派发、每步开始前都
 * `sessions.flush(session)`（上游 `SessionStore.flush` 会派发 `session/flush`）。
 * 因此用**同一个真 `SessionStore`** 的 `session/flush` 事件计数观察它：
 * 装上策略时一轮对话至少刷新一次；不装时一次都没有——对照组证明次数来自策略本身。
 *
 * 唯一假件是不联网的 LLM adapter（外部能力）。
 *
 * 断言因此是两条：策略在场时一轮对话跑完且会话被刷新；策略缺席时同一个循环里
 * 没有任何边界刷新（模型照常被调用）。两个方向一起才能证明刷新次数来自策略本身。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StreamChunk, type UserMessage } from "@morlay/dsh-agent";
import { LlmAdapter, MessageId } from "@morlay/dsh-agent/server";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { AgentLoop, Llm } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provideSessionCheckpointPolicy } from "../index.ts";

/** 假模型固定回这一句。 */
const REPLY = "检查点用例的回复。";

/** 假 adapter：不走网络，一次性吐完一句话。 */
class FakeAdapter extends LlmAdapter {
  calls = 0;

  async *stream(): AsyncIterable<StreamChunk> {
    this.calls += 1;
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: REPLY };
    yield { type: "block-end", index: 0, block: { type: "text", text: REPLY } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-checkpoint-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/**
 * 起栈并跑一轮：返回假 adapter 的调用次数与 `session/flush` 的派发次数。
 * @param withPolicy - 是否装 checkpoint 策略行。
 * @returns 两个计数。
 */
async function runOneTurn(withPolicy: boolean): Promise<{ adapterCalls: number; flushes: number }> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionPersistence(),
      RemoteHandlersDefault,
      FakeAppEnv,
      ...provideAgent(),
      ...(withPolicy ? provideSessionCheckpointPolicy() : []),
    ],
    timeoutMs: 20_000,
  });
  apps.push(app);

  let flushes = 0;
  app.on("session/flush", () => {
    flushes += 1;
  });

  const adapter = new FakeAdapter();
  app.get(Llm).registerAdapter(["deepseek-official"], adapter);

  // 会话标识用存储铸出来的真值（`prepare()` 不注册进目录，正好交给下一行去建）。
  const sessionId = app.get(SessionStore).prepare().id;
  const agent = await app
    .get(AgentLoop)
    .create(sessionId, { provider: "deepseek-official", model: "deepseek-flash" }, { cwd: root });
  agent.send(
    {
      id: MessageId("m1"),
      role: "user",
      content: [{ type: "text", text: "你好" }],
      source: { kind: "user" },
    } satisfies UserMessage,
    "next-turn",
    true,
  );
  await agent.whenIdle();

  return { adapterCalls: adapter.calls, flushes };
}

describe("checkpoint 策略", () => {
  it(
    "装上策略：每步开始前刷新会话（`session/flush` 至少派发一次）",
    { timeout: 30_000 },
    async () => {
      const { flushes } = await runOneTurn(true);

      expect(flushes).toBeGreaterThan(0);
    },
  );

  it("不装策略：同一轮对话里没有边界刷新，模型照常被调用", { timeout: 30_000 }, async () => {
    const { adapterCalls, flushes } = await runOneTurn(false);

    expect(adapterCalls).toBeGreaterThan(0);
    expect(flushes).toBe(0);
  });
});
