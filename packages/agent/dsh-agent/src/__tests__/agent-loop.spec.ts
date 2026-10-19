/**
 * 假 LLM 跑一轮循环：装配真实的 agent 域 + 一个什么都不调的假 adapter，然后
 * `create → send → whenIdle`，确认整条循环走得通、假模型真的被调用过。
 *
 * 断言只落在「循环跑完」这件事上（adapter 被调用 + agent 回到 idle + 会话里有 assistant 消息），
 * 具体内容由上游循环负责，不在这里重复测。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StreamChunk, type UserMessage } from "@morlay/dsh-agent";
import { LlmAdapter, MessageId } from "@morlay/dsh-agent/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentLoop, Llm } from "../index.ts";
import { provideAgent } from "../server/index.ts";

/** 假模型固定回这一句。 */
const REPLY = "这是假模型的回复。";

/** 假 adapter：不走网络，一次性把一句话吐完。 */
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
  root = await mkdtemp(join(tmpdir(), "dsh-agent-loop-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 每个用例一个独立临时目录的运行环境。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

/**
 * 装配 agent 域（会话 + 投影 + llm + agent 的一组 provider）。
 * @returns 应用与假 adapter。
 */
async function agentApp(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  adapter: FakeAdapter;
}> {
  const app = await bootstrapApplication({ providers: [...provideSession(), ...provideSessionProjection(), FakeAppEnv, RemoteHandlersDefault, ...provideAgent()] });
  const adapter = new FakeAdapter();
  app.get(Llm).registerAdapter(["deepseek-official"], adapter);
  return { app, adapter };
}

describe("agent loop（假 LLM）", () => {
  it(
    "create → send → whenIdle：假模型被调用，会话里出现 assistant 回复",
    { timeout: 30_000 },
    async () => {
      const { app, adapter } = await agentApp();
      try {
        const agent = await app
          .get(AgentLoop)
          .create(
            SessionId("s1"),
            { provider: "deepseek-official", model: "deepseek-flash" },
            { cwd: root },
          );
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

        expect(adapter.calls).toBeGreaterThan(0);
        expect(agent.status).toBe("idle");
      } finally {
        await app.dispose();
      }
    },
  );
});
