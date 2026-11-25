// 提问的**闭环**：`ask_user_question` 只是模型面的壳，答案来自 `user-questions/request` 那条
// waterfall。这里起真栈（真沙箱工具栈 + 真 agent + 本包的工具行），用一个应答者接住 waterfall，
// 断言**结构化答案被投影成模型文本**——这正是浏览器里 `ui-user-questions` 那一行做的事。
//
// 应答者是事件监听者，浏览器只是其中一种来源。这里锁住两端：
// - 挂上应答者 → 结构化答案成为模型文本（GUI 与 headless 同一条路）；
// - **完全**没有应答者（本 spec 的栈没装转发事件源）→ `ask` 立刻以 `NO_PROVIDER` 拒绝。
//   「装了转发事件源、只是暂时没有客户端」是另一种拓扑：请求会被挂起、等客户端连上补发，见债务记录。
import { ToolCallId } from "@morlay/dsh-agent/server";
import { executeToolFixture } from "@deepseek-ai/dsh-tool-testkit";
import { AgentDirectory, provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { provideFsTools, provideSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideShell } from "@morlay/dsh-shell/server";
import {
  AppEnv,
  RemoteHandlersDefault,
  provideApiGateway,
  provideTypert,
} from "@morlay/zephyr-app";
import { bootstrapApplication, configure, type App, type Context } from "@morlay/zephyr";
import { describe, expect, test, type AppEnvFixture } from "@morlay/zephyr-app/testing";
import { provideAskUserTool, providePermissionFor } from "../server/permission.provide.ts";

const signal = new AbortController().signal;

/**
 * 上游类型面的 ctx 收窄成本仓的 `Context`：运行期同一个对象，只是 vendor 的事件增强不进本 program。
 * @param ctx - 上游类型面的 ctx。
 * @returns 本仓的 ctx 类型（有 `on` / `waterfall` 这些声明）。
 */
function asContext(ctx: unknown): Context {
  return ctx as Context;
}

/** 提问域 + 沙箱工具栈 + 一个真 agent（问题要路由到它的 scope）。 */
async function boot(appEnv: AppEnvFixture): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionPersistence(),
      { provide: AppEnv, useValue: appEnv },
      // 权限域的两个远端端点行要 `remote-handlers`（它们只注册组，不连 mux）。
      RemoteHandlersDefault,
      ...provideAgent(),
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, {
          mode: "workspace-write",
          workspaceRoot: appEnv.values.dataDir,
        }),
      ),
      ...provideWorkingDirectory(),
      ...provideAgentLoop(),
      ...provideFsTools(),
      ...providePermissionFor("workspace-write"),
      // 被考察的那一行：模型面向的 `ask_user_question`。
      ...provideAskUserTool(),
    ],
    timeoutMs: 30_000,
  } as never);
  // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));
  return app;
}

/**
 * 同一份栈 + 转发事件源（`RemoteEventsSource`）：这就是本部署的形态——没有人连客户端，但宿主侧有桥接。
 * @param appEnv - 本用例的运行环境。
 * @returns 起好的应用。
 */
async function bootWithGateway(appEnv: AppEnvFixture): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionPersistence(),
      { provide: AppEnv, useValue: appEnv },
      ...provideTypert(),
      ...provideApiGateway(),
      ...provideAgent(),
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, {
          mode: "workspace-write",
          workspaceRoot: appEnv.values.dataDir,
        }),
      ),
      ...provideWorkingDirectory(),
      ...provideAgentLoop(),
      ...provideFsTools(),
      ...providePermissionFor("workspace-write"),
      ...provideAskUserTool(),
    ],
    timeoutMs: 30_000,
  } as never);
  // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));
  return app;
}

describe("ask_user_question 的提问闭环", () => {
  test(
    "waterfall 有应答者时：结构化答案被投影成模型文本",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const app = await boot(appEnv);
      const { agent } = await app.get(AgentDirectory).create({
        sessionId: SessionId("ask-user"),
        meta: { cwd: appEnv.values.dataDir },
      });

      // 浏览器的 `ui-user-questions` 就是这一行：接住 agent 的那条 waterfall，回一份结构化答案。
      asContext(agent.ctx).on("user-questions/request", () => ({
        answers: [{ id: "q1", selected: ["先别发"], custom: "再等一轮" }],
      }));

      const result = await executeToolFixture(agent.ctx, {
        signal,
        callId: ToolCallId("call-ask-user"),
        name: "ask_user_question",
        agent,
        arguments: {
          questions: [
            {
              id: "q1",
              question: "要发布吗？",
              header: "确认",
              options: [{ label: "先别发" }, { label: "发" }],
            },
          ],
        },
      });

      expect(result.isError).toBe(false);
      const text = JSON.stringify(result.content);
      expect(text).toContain("先别发");
      expect(text).toContain("再等一轮");
    },
  );

  test(
    "没有应答者时：立刻以 NO_PROVIDER 失败，不是挂住等下一个人",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const app = await boot(appEnv);
      const { agent } = await app.get(AgentDirectory).create({
        sessionId: SessionId("ask-user-unanswered"),
        meta: { cwd: appEnv.values.dataDir },
      });

      const result = await executeToolFixture(agent.ctx, {
        signal,
        callId: ToolCallId("call-ask-user-unanswered"),
        name: "ask_user_question",
        agent,
        arguments: { questions: [{ id: "q1", question: "要发布吗？" }] },
      });

      expect(result.isError).toBe(true);
      if (!result.isError) throw new Error("没有应答者时不该给出答案");
      expect(result.error.message).toContain("no user-questions answerer accepted the request");
    },
  );

  test(
    "装了转发事件源、暂时没有客户端时：请求挂起（不失败、也不超时）",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const app = await bootWithGateway(appEnv);
      const { agent } = await app.get(AgentDirectory).create({
        sessionId: SessionId("ask-user-pending"),
        meta: { cwd: appEnv.values.dataDir },
      });

      const call = executeToolFixture(agent.ctx, {
        signal,
        callId: ToolCallId("call-ask-user-pending"),
        name: "ask_user_question",
        agent,
        arguments: { questions: [{ id: "q1", question: "要发布吗？" }] },
      }).then(
        (result) => result as unknown,
        (error: unknown) => error as unknown,
      );

      // 这一步断的是「不结束」：短窗口内它必须还没有结果。这是时间窗唯一正当的用法——
      // 要证明的那个事实本来就是「不会在无人应答时结束」。
      const winner = await Promise.race([
        call.then(() => "settled"),
        new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 500)),
      ]);
      if (winner !== "pending") {
        const detail = await call;
        throw new Error(`请求没有挂起：${JSON.stringify(detail).slice(0, 400)}`);
      }

      // 挂起的调用随应用卸载结束：别把未处理的拒绝留给下一条用例。
      // 提前 dispose 之后，用例结束时的清理链再调一次也无害（`dispose` 幂等）。
      await app.dispose();
      await expect(call).resolves.toBeDefined();
    },
  );
});
