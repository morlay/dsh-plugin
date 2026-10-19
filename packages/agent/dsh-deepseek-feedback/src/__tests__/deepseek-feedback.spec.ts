/**
 * deepseek-feedback 的真装配：真 `CommandRuntime`（我们的 `CommandRegistryDefault` 接管）
 * + 真上游 `command-feedback` 插件——这行是**真实贡献方**，命令定义在上游，登记走本包的注册表。
 *
 * 断言：装完之后，命令目录里真的出现 `feedback` 这一条。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { AgentLoop } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { CommandCatalog } from "@morlay/dsh-command/endpoint";
import { CommandRegistry } from "@morlay/dsh-command";
import { CommandRegistryDefault } from "@morlay/dsh-command";
import { RegistryCatalog } from "@morlay/dsh-command/server";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { afterEach, describe, expect, it } from "vitest";
import { provideCommandFeedback } from "../index.ts";

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/**
 * 起真命令栈 + feedback 行，并建一个真的空闲 agent。
 *
 * 命令目录按**会话**查询（`CommandCatalog.list(sessionId)`，只读契约）；它背后仍要一个活 agent
 * （目录实现按 `AgentDirectory.get` 解析作用域），所以这里建真的，不造假对象。
 * @returns 应用与会话身份。
 */
async function boot(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  sessionId: Parameters<CommandCatalog["list"]>[0];
}> {
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    
      ...provideAgent(),
      CommandRegistryDefault,
      RegistryCatalog,
      ...provideCommandFeedback(),
    ],
    timeoutMs: 20_000,
  });
  apps.push(app);
  const sessionId = app.get(SessionStore).prepare().id;
  await app.get(AgentLoop).create(sessionId, {
    provider: "deepseek-official",
    model: "deepseek-flash",
  });
  return { app, sessionId };
}

describe("deepseek-feedback 的命令行", () => {
  it("装配后 CommandRegistry 可解析", async () => {
    const { app } = await boot();
    expect(typeof app.get(CommandRegistry).register).toBe("function");
  });

  it("feedback 命令真的登记进了目录", async () => {
    const { app, sessionId } = await boot();
    // 读目录走只读契约（`CommandCatalog`），不碰注册表的实现面。
    const entries = await app.get(CommandCatalog).list(sessionId);

    expect(entries.map((entry) => entry.name)).toContain("feedback");
    expect(entries.find((entry) => entry.name === "feedback")?.description).toBeTruthy();
  });
});
