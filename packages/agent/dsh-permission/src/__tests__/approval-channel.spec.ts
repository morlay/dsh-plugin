// 批准**通道**的装配判据：装上权限域之后，沙箱升级请求不再停在「没有批准服务」，而是真的进了
// 本仓的 `ApprovalService`（`ctx.approval`）——它是被工具行按名字读到的，不是上游工具自带的。
//
// 这条用例不需要 UI 应答者，也不需要开 turn：`ApprovalService.request` 在 turn 之外**拒绝**（审计对
// 必须落在 turn 内），所以执行以拒绝结束、命令一条没跑。这正是「有通道但此刻不能问」的 fail-closed。
import { ToolCallId } from "@morlay/dsh-agent/server";
import { executeToolFixture } from "@deepseek-ai/dsh-tool-testkit";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { AgentDirectory, provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { SandboxPolicyDefault, provideFsTools, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { AppEnv, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { describe, expect, test, type AppEnvFixture } from "@morlay/zephyr-app/testing";
import { providePermissionFor } from "../server/permission.provide.ts";

const signal = new AbortController().signal;

/** 权限域 + 沙箱工具栈 + 一个真 agent（升级请求要 agent 才能路由到审批）。 */
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
      // 权限域：批准服务（`approval`）+ 预设 + 用户提问队列。
      ...providePermissionFor("workspace-write"),
    ],
    timeoutMs: 30_000,
  } as never);
  // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));
  return app;
}

describe("沙箱升级走的批准通道", () => {
  test(
    "升级请求真的进了本仓的批准服务：不再是「没有批准服务」，而是「此刻不能问」",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const app = await boot(appEnv);
      const { agent } = await app.get(AgentDirectory).create({
        sessionId: SessionId("approval-channel"),
        meta: { cwd: appEnv.values.dataDir },
      });
      const marker = join(appEnv.values.dataDir, "approval-marker");

      // 用 agent 自己的 scope 跑流水线：工具就登记在这一层。
      const result = await executeToolFixture(agent.ctx, {
        signal,
        callId: ToolCallId("call-approval-channel"),
        name: "bash",
        agent,
        arguments: {
          command: "touch " + JSON.stringify(marker),
          description: "写一个标记文件",
          sandbox_permissions: "danger-full-access",
          justification: "验证批准通道已经接上工具行",
        },
      });

      expect(result.isError).toBe(true);
      if (!result.isError) throw new Error("升级请求不该在 turn 之外被放行");
      const message = result.error.message;
      // 关键差别：批准服务被找到了（否则这里是 "no approval service" / "no agent"）。
      expect(message).not.toContain("no approval service");
      expect(message).not.toContain("no agent to route it through");
      expect(message).toContain("outside an open turn");
      // 判定在任何执行之前：命令的副作用不存在。
      await expect(access(marker)).rejects.toThrow();
    },
  );
});
