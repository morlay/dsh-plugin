// 这一行的局部闭环：它 + 它要的真依赖（fs / 工作目录 / 投影注册表 / 系统提示）。
//
// 它没有自己的契约面（挂在系统提示装配上），所以判据是「依赖真的都满足、行装得上」——
// 它 inject 的两个服务（`SessionProjectionStore` / `WorkingDirectory`）与上游要的 `systemPrompt`
// 都在同一装配里就位，`AgentInstruction` 才不会在 apply 期挂掉。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { AgentDirectoryDefault, SystemPromptDefault } from "@morlay/dsh-agent/server";
import { provideAgentInstruction } from "@morlay/dsh-agent-instruction";
import { FileSystem } from "@morlay/dsh-fs";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { WorkingDirectory, provideWorkingDirectory, WorkingDirectoryDefault } from "@morlay/dsh-working-directory";
import { bootstrapApplication, Injectable, type App, type Context, configure } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { afterEach, describe, expect, it } from "vitest";

/** 测试内的 fs：上游本地文件系统经 `fromCordis` 接管到本仓契约令牌。 */
@Injectable()
class LocalFs extends fromCordis(FileSystem, LocalFileSystem) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

async function boot(): Promise<App> {
  const root = await mkdtemp(join(tmpdir(), "dsh-agent-instruction-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideSessionProjection(),
    
      LocalFs,
      AgentDirectoryDefault,
      SystemPromptDefault,
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      ...provideAgentInstruction(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("agent 指令行", () => {
  it("依赖都在同一装配里就位，行装得上", { timeout: 20_000 }, async () => {
    const app = await boot();
    // 它 inject 的两个服务 + 上游要的系统提示。
    expect(app.get(FileSystem)).toBeDefined();
    expect(app.get(WorkingDirectory)).toBeDefined();
    expect(app.get(SessionProjectionStore)).toBeDefined();
  });
});
