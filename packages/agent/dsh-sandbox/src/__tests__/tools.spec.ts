// env-tool 域的局部闭环：真 `tool-bash` / `tool-fs` / `tool-fs-search` / `tool-working-directory`
// 四行 + 真的 shell / 沙箱 / 工作目录栈，只把工作区根换成临时目录。
//
// 判据是四个工具**都真的登记进了工具注册表**：工具定义在上游，本仓的行只负责交依赖。
import { LlmDefault, SystemPromptDefault, ToolRegistryDefault } from "@morlay/dsh-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentDirectoryDefault } from "@morlay/dsh-agent";
import { provideFsTools } from "../fs-tools.provide.ts";
import { provideSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideShell } from "@morlay/dsh-shell/server";

import {
  WorkingDirectoryDefault,
  provideEnvTools,
  provideWorkingDirectory,
} from "@morlay/dsh-agent";
import { bootstrapApplication, type App, configure } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 30_000);

async function boot(): Promise<App> {
  const root = await mkdtemp(join(tmpdir(), "dsh-env-tool-"));
  roots.push(root);
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
      // 工具行按能力域分装：`bash` / 文件 / 检索在 sandbox，`working_directory` 在 agent。
      ...provideFsTools(),
      ...provideEnvTools(),
    ],
    timeoutMs: 30_000,
  } as never);
  opened.push(app);
  return app;
}

describe("env-tool 域", () => {
  it("四条工具行都真的登记了工具", { timeout: 30_000 }, async () => {
    const app = await boot();
    const tools = app.get(ToolRegistry);

    expect(tools.get("bash")).toBeDefined();
    expect(tools.get("read")).toBeDefined();
    expect(tools.get("glob")).toBeDefined();
    expect(tools.get("working_directory")).toBeDefined();
  });
});
