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
import { tmpdir } from "node:os";
import type { UserMessage } from "@morlay/dsh-agent";
import { MessageId } from "@morlay/dsh-agent";
import { FakeLlmAdapter } from "@morlay/dsh-agent/testing";
import { bootstrapApplication, configure, without } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { describe, expect, test, type AppEnvFixture } from "@morlay/zephyr-app/testing";
import { Llm } from "@morlay/dsh-agent";
import { AgentLoop } from "../contract/index.ts";
import { provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideAgentLoop } from "../index.ts";
import { SessionCheckpointPolicy } from "../checkpoint-policy.service.ts";

/**
 * 起栈并跑一轮：返回假 adapter 的调用次数与 `session/flush` 的派发次数。
 * @param withPolicy - 是否装 checkpoint 策略行。
 * @returns 两个计数。
 */
async function runOneTurn(
  withPolicy: boolean,
  appEnv: AppEnvFixture,
): Promise<{ adapterCalls: number; flushes: number }> {
  // 两个分支各自**完整内联**：装配清单的类型是字面量元组（断言器要它），抽成变量会退化成数组。
  const app = await bootstrapApplication({
    providers: withPolicy
      ? [
          ...provideSession(),
          ...provideSessionProjection(),
          ...provideSessionPersistence(),
          RemoteHandlersDefault,
          { provide: AppEnv, useValue: appEnv },
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
          ...provideSessionPersistence(),
          RemoteHandlersDefault,
          { provide: AppEnv, useValue: appEnv },
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

  // 卸载登记到 fixture 的清理链：它跑在「删临时目录」**之前**。写成 `onTestFinished(() => app.dispose())`
  // 会晚于删目录（实测），dispose 的会话落盘就把 `sessions/` 写回已删除的根，留下 `zephyr-spec-*` 残骸。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));

  let flushes = 0;
  // 事件是**与 cordis 的接缝**：派发走 `ctx.parallel("session/flush")`，监听也走 ctx，不占服务名。
  (app.ctx as unknown as { on(name: string, fn: () => void): () => void }).on(
    "session/flush",
    () => {
      flushes += 1;
    },
  );

  const adapter = new FakeLlmAdapter();
  app.get(Llm).registerAdapter(["deepseek-official"], adapter);

  // 会话标识用存储铸出来的真值（`prepare()` 不注册进目录，正好交给下一行去建）。
  const sessionId = app.get(SessionStore).prepare().id;
  const agent = await app
    .get(AgentLoop)
    .create(
      sessionId,
      { provider: "deepseek-official", model: "deepseek-flash" },
      { cwd: appEnv.values.dataDir },
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

  return { adapterCalls: adapter.calls, flushes };
}

describe("checkpoint 策略", () => {
  test(
    "装上策略：每步开始前刷新会话（`session/flush` 至少派发一次）",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const { flushes } = await runOneTurn(true, appEnv);

      expect(flushes).toBeGreaterThan(0);
    },
  );

  test(
    "不装策略：同一轮对话里没有边界刷新，模型照常被调用",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const { adapterCalls, flushes } = await runOneTurn(false, appEnv);

      expect(adapterCalls).toBeGreaterThan(0);
      expect(flushes).toBe(0);
    },
  );
});
