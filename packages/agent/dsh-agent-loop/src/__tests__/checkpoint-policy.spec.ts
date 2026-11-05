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
import type { UserMessage } from "@morlay/dsh-agent";
import { MessageId } from "@morlay/dsh-agent";
import { FakeLlmAdapter } from "@morlay/dsh-agent/testing";
import { bootstrapApplication, configure, Injectable, without } from "@morlay/zephyr";
import { Events } from "@morlay/dsh-session";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { Llm } from "@morlay/dsh-agent";
import { AgentLoop } from "../contract/index.ts";
import { provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provideAgentLoop } from "../index.ts";
import { SessionCheckpointPolicy } from "../checkpoint-policy.service.ts";

let root = "";

// 每个用例一份数据根：持久化会把盘上的会话加载回 `SessionStore`，共用目录时前一个用例的
// `session-1` 会让后一个用例的 `prepare()` 撞已经存在的 id。
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-checkpoint-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root };

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
  // 两个分支各自**完整内联**：装配清单的类型是字面量元组（断言器要它），抽成变量会退化成数组。
  const app = await bootstrapApplication({
    providers: withPolicy
      ? [
          ...provideSession(),
          ...provideSessionProjection(),
          Events.SessionFlush,
          ...provideSessionPersistence(),
          RemoteHandlersDefault,
          FakeAppEnv,
          ...provideAgent(),
          ...provideShell(),
          ...provideSandbox(
            configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: tmpdir() }),
          ),
          ...provideWorkingDirectory(),
          // 策略行由循环期的聚合入口带进来（`provideAgentLoop()`）。
          ...provideAgentLoop(),
        ]
      : [
          ...provideSession(),
          ...provideSessionProjection(),
          Events.SessionFlush,
          ...provideSessionPersistence(),
          RemoteHandlersDefault,
          FakeAppEnv,
          ...provideAgent(),
          ...provideShell(),
          ...provideSandbox(
            configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: tmpdir() }),
          ),
          ...provideWorkingDirectory(),
          // 循环本体要装（要跑一轮），但 checkpoint 策略行剔除——对照组。
          ...provideAgentLoop(without(SessionCheckpointPolicy)),
        ],
    timeoutMs: 20_000,
  } as never);
  apps.push(app);

  let flushes = 0;
  // 事件走 `EventEmitter`：事件名与参数表都在 `SessionFlush` 类里，不裸写字符串。
  app.get(Events.SessionFlush).on(() => {
    flushes += 1;
  });

  const adapter = new FakeLlmAdapter();
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
