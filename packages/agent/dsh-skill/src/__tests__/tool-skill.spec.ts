// 技能工具行（`provideSkill()` 里的 `ToolSkill`）的局部闭环：真 `tool-skill` 插件 +
// 真 `ToolRegistry` / `AgentDirectory` / `Skill` / 真工作目录。
//
// 判据是「工具真的登记进了工具注册表」：上游插件在 apply 里登记 `skill` 这一个工具，
// 本仓的行只负责把它要的依赖交进去。工具的定义（`name` / `schema`）在上游，这里不复制一份。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentDirectoryDefault, SystemPromptDefault, ToolRegistryDefault } from "@morlay/dsh-agent/server";
import { FileSystem } from "@morlay/dsh-fs";
import { provideSessionProjection, provideSessionQuerySqlite } from "@morlay/dsh-session/server";
import { SkillDefault } from "@morlay/dsh-skill";
import { ToolSkill } from "@morlay/dsh-skill/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-working-directory";
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
  const root = await mkdtemp(join(tmpdir(), "dsh-skill-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [
      // 只装这条工具行自己要的两行：域装配函数 `provideSkill()` 还带 `skills` 端点，
      // 端点要 remote-handlers / session-query，会被拽进半套会话栈。端点的判据在
      // `session-skill-catalog.spec.ts`（装真 `provideSkill()`）。
      ...provideSessionProjection(),
      SkillDefault,
      ToolSkill,
      LocalFs,
      SystemPromptDefault,
      AgentDirectoryDefault,
      ToolRegistryDefault,
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("skill 域的技能工具行", () => {
  it("装完这一行，`skill` 工具在工具注册表里", { timeout: 20_000 }, async () => {
    const app = await boot();
    expect(app.get(ToolRegistry).get("skill")).toBeDefined();
  });
});
