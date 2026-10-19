/**
 * `@Command()` 的局部闭环：贡献方只写类，装配期自动登记，行卸载时自动撤销。
 *
 * 没有假件：注册表用 `CommandRegistryDefault`（接上游 `CommandRuntime`），目录与执行器用同进程实现
 * （`RegistryCatalog` / `RegistryRunner`），agent 目录由真的 agent 循环兑现。
 */
import type { CommandInvocation, CommandResult } from "@morlay/dsh-command/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentLoop } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { Command } from "../index.ts";
import { CommandCatalog, CommandRegistryDefault, CommandRunner, type CommandContribution } from "../index.ts";
import { RegistryCatalog, RegistryRunner } from "@morlay/dsh-command/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

/** 会话身份：agent 目录与命令目录都按它寻址。 */
const SESSION = SessionId("s1");

/** 被测的命令贡献：只有类自己的东西，没有 `registry.register(...)`。 */
@Command()
class GoalCommand implements CommandContribution {
  readonly name = "goal";

  readonly description = "设定或查看当前目标";

  /** 实例状态：`this` 绑错了就写不进来（`Contribute` 的投影就是为这个存在的）。 */
  readonly handled: string[] = [];

  handler(invocation: CommandInvocation): CommandResult {
    this.handled.push(invocation.rawInput.trim());
    return { kind: "success", text: "ok" };
  }
}

/**
 * 装配一条命令贡献 + 真注册表 + 同进程端口。
 * @returns 应用。
 */
async function commandApp(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    
      ...provideAgent(),
      CommandRegistryDefault,
      RegistryCatalog,
      RegistryRunner,
      GoalCommand,
    ],
    timeoutMs: 20_000,
  });
  // 目录与执行器都按 agent 作用域解析：建一个真的空闲 agent（`announce` 会进目录）。
  await app.get(AgentLoop).create(SESSION, {
    provider: "deepseek-official",
    model: "deepseek-flash",
  });
  return app;
}

describe("@Command：装配期登记、卸载期撤销", () => {
  it("目录看得到它，执行走到它的 handler（`this` 是实例）", async () => {
    const app = await commandApp();
    try {
      const catalog = app.get(CommandCatalog);
      // 链路自证：目录实现是同进程那一份，不经过 remote。
      expect(catalog).toBeInstanceOf(RegistryCatalog);
      const entries = await catalog.list(SESSION);
      expect(entries.map((entry) => entry.name)).toEqual(["goal"]);
      expect(entries[0]?.description).toBe("设定或查看当前目标");

      await app.get(CommandRunner).run(SESSION, "goal", "v2");
      expect(app.get(GoalCommand).handled).toEqual(["v2"]);
    } finally {
      await app.dispose();
    }
  });

  it("卸载后 disposer 把它摘掉：目录回到空", async () => {
    const app = await commandApp();
    const catalog = app.get(CommandCatalog);
    try {
      expect(await catalog.list(SESSION)).toHaveLength(1);
    } finally {
      await app.dispose();
    }
    expect(await catalog.list(SESSION)).toEqual([]);
  });
});
