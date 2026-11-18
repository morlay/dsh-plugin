// 技能工具行（`provideSkill()` 里的 `ToolSkill`）的局部闭环：真 `tool-skill` 插件 +
// 真 `ToolRegistry` / `AgentDirectory` / `Skill` / 真工作目录。
//
// 判据是「工具真的登记进了工具注册表」：上游插件在 apply 里登记 `skill` 这一个工具，
// 本仓的行只负责把它要的依赖交进去。工具的定义（`name` / `schema`）在上游，这里不复制一份。
import {
  AgentScopedRows,
  AgentScopedRowsDefault,
  SystemPromptDefault,
  ToolRegistryDefault,
} from "@morlay/dsh-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentDirectoryDefault } from "@morlay/dsh-agent";
import { FileSystem } from "@morlay/dsh-fs";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { SkillDefault } from "@morlay/dsh-skill";
import { ToolSkill } from "@morlay/dsh-skill/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-agent";
import {
  bootstrapApplication,
  Injectable,
  type App,
  type Context,
  configure,
} from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { afterEach, describe, expect, it } from "vitest";

/** 测试内的 fs：上游本地文件系统经 `fromCordis` 接管到本仓契约令牌。 */
@Injectable()
class LocalFs extends fromCordis(FileSystem, LocalFileSystem) {
  override async onInit(ctx: Context): Promise<void> {
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
      // 顺序即装配顺序：适配行（`Skill` / `ToolRegistry` / `SystemPrompt` / `AgentDirectory`）
      // 的契约面在它们自己的 onInit 之后才就位，工具行要排在它们后面。
      ...provideSessionProjection(),
      LocalFs,
      SkillDefault,
      SystemPromptDefault,
      AgentDirectoryDefault,
      ToolRegistryDefault,
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      // per-agent 行的装行能力：装了 `@AgentScoped()` 行的最小装配也要有它（agent 骨架里带一条）。
      AgentScopedRowsDefault,
      ToolSkill,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("skill 域的技能工具行", () => {
  it("这一行按 agent 装配：装进某个 scope 才登记 `skill`，应用根上没有它", { timeout: 20_000 }, async () => {
    const app = await boot();
    // 行声明了 `@AgentScoped()`：装配期不装根，工具也就还没登记。
    expect(app.get(ToolRegistry).definitions(), "应用根上不该有它").toEqual([]);

    const scope = (app.ctx as Context).extend();
    // 装进这个 scope 不抛 = 上游 `ctx.tools.register` 在这个 agent 的服务面上成功了；
    // 若还传的是根那份实例，第二个 scope 再装就会撞名。
    await app.get(AgentScopedRows).install(scope);
    // 装进这个 scope 之后工具才出现，且没抛「already registered」——说明登记落在这个 agent 的
    // 服务面（上游 `ctx.tools.register` 的作用域取自传进去的那份代理）。
    expect(app.get(ToolRegistry).definitions().map((tool) => tool.name)).toContain("skill");
  });
});
