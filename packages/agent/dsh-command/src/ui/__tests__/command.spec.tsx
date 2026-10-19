/**
 * 从 ui 完整走一遍：`CommandPaletteStore` → `RemoteCommandCatalog` → 契约转发
 * → `CommandEndpointDefault` → `CommandRegistryDefault`（真实现）→ 上游 `CommandRuntime`。
 *
 * 两个假件各司其职，业务侧全是真的：
 * - `LocalRemote`：**传输层**替身（把 `remote.upstream.commands.*` 接到本进程的 handler 表）；
 * - `FakeAgentDirectory`：`AgentDirectory` 端口（agent 域的契约，真实现在 `dsh-agent`）。
 */
import { SessionId } from "@morlay/dsh-session/endpoint";
import { bootstrapApplication } from "@morlay/zephyr";
import { provideLocalRemote } from "@morlay/zephyr-app/testing";
import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../../index.ts";
import { CommandCatalog, CommandRegistryDefault } from "../../index.ts";
import { AgentLoop } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { CommandEndpointDefault } from "@morlay/dsh-command/server";
import {
  CommandEndpointClient,
  CommandPaletteStore,
  RemoteCommandCatalog,
  RemoteCommandRunner,
} from "@morlay/dsh-command/ui";

/**
 * 装配整条 ui → server 链。
 * @returns 应用。
 */
async function commandApp(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    // 进程内传输：宿主半的 handler 表 + 客户端半的 `Remote` 实现，一个模块搞定。
    providers: [
      ...provideLocalRemote(),
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideAgent(),
      CommandRegistryDefault,
      CommandEndpointDefault,
      CommandEndpointClient,
      RemoteCommandCatalog,
      RemoteCommandRunner,
      CommandPaletteStore,
    ],
    timeoutMs: 20_000,
  });
  // 命令目录与执行都经 `AgentDirectory.get(sessionId)`：先建一个真的空闲 agent（`announce` 会进目录）。
  await app
    .get(AgentLoop)
    .create(
      SessionId("s1"),
      { provider: "deepseek-official", model: "deepseek-flash" },
      { cwd: process.cwd() },
    );
  return { app };
}

describe("commands 从 ui 走到底", () => {
  it("注册一条命令后：store 列得出、执行走到它的 handler", async () => {
    const { app } = await commandApp();
    try {
      const ran: { name: string; rawInput: string }[] = [];
      app.get(CommandRegistry).register({
        name: "model",
        description: "切换模型",
        handler: async (invocation) => {
          ran.push({
            name: "model",
            rawInput: String((invocation as { rawInput?: string }).rawInput ?? ""),
          });
          return { kind: "success", text: "ok" };
        },
      });

      const store = app.get(CommandPaletteStore);
      // 链路自证：store 用的目录实现必须是走 remote 的那一个，而不是同进程直连。
      expect(app.get(CommandCatalog)).toBeInstanceOf(RemoteCommandCatalog);
      await store.open("s1");
      expect(store.visibleOf(store.stateOf("s1")).map((entry) => entry.name)).toEqual(["model"]);

      await store.run("s1");
      expect(ran).toHaveLength(1);
      expect(store.stateOf("s1").open).toBe(false);
    } finally {
      await app.dispose();
    }
  });

  it("未知会话：目录为空", async () => {
    const { app } = await commandApp();
    try {
      const store = app.get(CommandPaletteStore);
      await store.open("nope");
      expect(store.stateOf("nope").entries).toEqual([]);
    } finally {
      await app.dispose();
    }
  });
});
