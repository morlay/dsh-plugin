// env-tool 域的局部闭环：真 `tool-bash` / `tool-fs` / `tool-fs-search` / `tool-working-directory`
// 四行 + 真的 shell / 沙箱 / 工作目录栈，只把工作区根换成临时目录。
//
// 两组判据：
// 1. 工具**真的登记进了工具注册表**：工具定义在上游，本仓的行只负责交依赖；
// 2. 沙箱升级的**批准通道**：受约束执行器在时 `bash` 广告 `sandbox_permissions`，且升级请求
//    先于执行被判定——没有批准服务时按 `SANDBOX_ESCALATION_UNAVAILABLE` 拒绝，命令一条都没跑。
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { executeToolFixture } from "@deepseek-ai/dsh-tool-testkit";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentDirectoryDefault } from "@morlay/dsh-agent";
import { provideFsTools } from "../fs-tools.provide.ts";
import { provideSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideShell } from "@morlay/dsh-shell/server";

import { LlmDefault, SystemPromptDefault, ToolRegistryDefault } from "@morlay/dsh-agent";
import {
  AgentScopedRows,
  AgentScopedRowsDefault,
  WorkingDirectoryDefault,
  provideWorkingDirectory,
} from "@morlay/dsh-agent";
import { bootstrapApplication, type App, type Context, configure } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

/** 一次调用的取消面（升级判定在读参数时就发生，signal 不会被真正用到）。 */
const signal = new AbortController().signal;

async function boot(): Promise<{ app: App; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-env-tool-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),

      LlmDefault,
      SystemPromptDefault,
      ToolRegistryDefault,
      AgentDirectoryDefault,
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root }),
      ),
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      // per-agent 行的装行能力：这四条工具行都声明了 `@AgentScoped()`（工具按 agent 注册）。
      AgentScopedRowsDefault,
      // 工具行按能力域分装：`bash` / 文件 / 检索都在 sandbox。
      ...provideFsTools(),
    ],
    timeoutMs: 30_000,
  } as never);
  onTestFinished(() => app.dispose().catch(() => {}));
  return { app, root };
}

/** 把 per-agent 的行装进一个 agent scope，返回那个 scope（工具在这一层才登记）。 */
async function installAgentRows(app: App): Promise<Context> {
  const scope = (app.ctx as unknown as Context).extend();
  await app.get(AgentScopedRows).install(scope);
  return scope;
}

describe("env-tool 域", () => {
  test(
    "四条工具行都真的登记了工具（装进某个 agent 的 scope 之后）",
    { timeout: 30_000 },
    async () => {
      const { app } = await boot();
      // 这四条行都声明了 `@AgentScoped()`：装配期不装根，工具也就还没登记。
      expect(app.get(ToolRegistry).definitions()).toEqual([]);

      await installAgentRows(app);

      const names = app
        .get(ToolRegistry)
        .definitions()
        .map((tool) => tool.name);
      expect(names).toContain("bash");
      expect(names).toContain("read");
      expect(names).toContain("glob");
    },
  );

  test(
    "受约束执行器在时 `bash` 广告 `sandbox_permissions`（策略行与执行器都到位）",
    { timeout: 30_000 },
    async () => {
      const { app } = await boot();
      await installAgentRows(app);

      const schema = app
        .get(ToolRegistry)
        .schemas()
        .find((item) => item.name === "bash");
      if (schema === undefined) throw new Error("bash 没有 schema：工具行没装上");

      // 投影后的参数面（模型看到的那份）：enum 是封闭的升级目标词表，按组合的默认模式一次性钉死。
      const parameters = JSON.stringify(schema.parameters);
      expect(parameters).toContain("sandbox_permissions");
      expect(parameters).toContain("workspace-write");
      expect(parameters).toContain("danger-full-access");
    },
  );

  test(
    "升级请求先于执行判定：没有批准服务时以 `SANDBOX_ESCALATION_UNAVAILABLE` 拒绝，命令没跑",
    { timeout: 30_000 },
    async () => {
      const { app, root } = await boot();
      const scope = await installAgentRows(app);
      const marker = join(root, "escalation-marker");

      const result = await executeToolFixture(scope, {
        signal,
        callId: ToolCallId("call-escalation"),
        name: "bash",
        arguments: {
          command: "touch " + JSON.stringify(marker),
          description: "写一个标记文件",
          sandbox_permissions: "danger-full-access",
          justification: "验证升级请求先经过批准通道",
        },
      });

      expect(result.isError).toBe(true);
      if (!result.isError) throw new Error("升级请求不该被放行");
      expect(result.error.info?.code).toBe("SANDBOX_ESCALATION_UNAVAILABLE");
      expect(result.error.message).toContain("no approval service");
      // 判定在任何执行之前：命令的副作用不存在。
      await expect(access(marker)).rejects.toThrow();
    },
  );
});
