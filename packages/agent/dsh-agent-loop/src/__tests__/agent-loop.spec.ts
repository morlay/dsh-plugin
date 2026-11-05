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
import type { UserMessage } from "@morlay/dsh-agent";
import { MessageId } from "@morlay/dsh-agent";
import { FakeLlmAdapter } from "@morlay/dsh-agent/testing";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { bootstrapApplication, configure, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Llm } from "@morlay/dsh-agent";
import { AgentLoop } from "../contract/index.ts";
import { provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { provideAgentLoop } from "../index.ts";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";

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
  readonly values: AppEnvValues = { dataDir: root, profileDir: root };

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
  adapter: FakeLlmAdapter;
}> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionPersistence(),
      FakeAppEnv,
      RemoteHandlersDefault,
      ...provideAgent(),
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: tmpdir() }),
      ),
      ...provideWorkingDirectory(),
      // 循环期：本 spec 要真 `AgentLoop`。
      ...provideAgentLoop(),
    ],
  } as never);
  const adapter = new FakeLlmAdapter();
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
