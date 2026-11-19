// 批准**通道**的装配判据：装上权限域之后，沙箱升级请求不再停在「没有批准服务」，而是真的进了
// 本仓的 `ApprovalService`（`ctx.approval`）——它是被工具行按名字读到的，不是上游工具自带的。
//
// 这条用例不需要 UI 应答者，也不需要开 turn：`ApprovalService.request` 在 turn 之外**拒绝**（审计对
// 必须落在 turn 内），所以执行以拒绝结束、命令一条没跑。这正是「有通道但此刻不能问」的 fail-closed。
import { ToolCallId } from "@morlay/dsh-agent/server";
import { executeToolFixture } from "@deepseek-ai/dsh-tool-testkit";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDirectory, provideAgent, provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { SandboxPolicyDefault, provideFsTools, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { AppEnv, RemoteHandlersDefault, type AppEnvValues } from "@morlay/zephyr-app";
import { bootstrapApplication, configure, Injectable, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { providePermissionFor } from "../server/permission.provide.ts";

let root = "";

const opened: App[] = [];

const signal = new AbortController().signal;

/** 运行环境替身（与 agent-loop 的用例同形）：数据根指到临时目录。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  if (root !== "") await rm(root, { recursive: true, force: true });
}, 30_000);

/** 权限域 + 沙箱工具栈 + 一个真 agent（升级请求要 agent 才能路由到审批）。 */
async function boot(): Promise<App> {
  root = await mkdtemp(join(tmpdir(), "dsh-approval-channel-"));
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionPersistence(),
      FakeAppEnv,
      // 权限域的两个远端端点行要 `remote-handlers`（它们只注册组，不连 mux）。
      RemoteHandlersDefault,
      ...provideAgent(),
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root }),
      ),
      ...provideWorkingDirectory(),
      ...provideAgentLoop(),
      ...provideFsTools(),
      // 权限域：批准服务（`approval`）+ 预设 + 用户提问队列。
      ...providePermissionFor("workspace-write"),
    ],
    timeoutMs: 30_000,
  } as never);
  opened.push(app);
  return app;
}

describe("沙箱升级走的批准通道", () => {
  it(
    "升级请求真的进了本仓的批准服务：不再是「没有批准服务」，而是「此刻不能问」",
    { timeout: 30_000 },
    async () => {
      const app = await boot();
      const { agent } = await app.get(AgentDirectory).create({
        sessionId: SessionId("approval-channel"),
        meta: { cwd: root },
      });
      const marker = join(root, "approval-marker");

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
