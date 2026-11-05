// 装配面守护：两条 MCP 客户端行同装不撞令牌、各自拿到自己的实例、configure 真的改到配置，
// 以及缺 bin 时装配不失败（上游 failOnStartupError 默认 false 的语义）。
//
// **不起真的 agent-browser mcp 子进程**：这两条命令在测试机上不存在，stdio 一开就 ENOENT，
// 上游把失败记进日志并进入重连循环（定时器 unref，不影响退出）——那正是要验的「缺 bin 不失败」。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { ToolRegistry } from "@morlay/dsh-agent";
import { describe, expect, it } from "vitest";
import { AgentBrowserUse, AgentDesktopUse } from "@morlay/agent-use";
import { provideAgentUse } from "@morlay/agent-use";

// 工具注册表：这两条行在连接失败前不会注册工具，给一个明确失败的替身即可
// （真注册了就是测试该发现的事）。
const toolRegistryStub = {
  register: () => {
    throw new Error("两条行都不该在这个测试里注册工具（连接会在 ENOENT 处失败）");
  },
};

describe("agent-use 的两条 MCP 客户端行", () => {
  it("两条同装：都能取到，且不是同一个实例", async () => {
    const app = await bootstrapApplication({
      providers: [
        { provide: ToolRegistry as never, useValue: toolRegistryStub },
        ...provideAgentUse(),
      ],
      timeoutMs: 8_000,
    });
    try {
      const browser = app.get(AgentBrowserUse as never) as AgentBrowserUse;
      const desktop = app.get(AgentDesktopUse as never) as AgentDesktopUse;
      expect(browser).toBeInstanceOf(AgentBrowserUse);
      expect(desktop).toBeInstanceOf(AgentDesktopUse);
      expect(browser).not.toBe(desktop);
      // 两条各自连自己的 server：serverName 不同，工具名才不会互相遮蔽。
      expect((browser as unknown as { config: Record<string, unknown> }).config).toMatchObject({
        transport: "stdio",
        serverName: "agent_browser",
        command: "agent-browser",
        args: ["mcp"],
      });
      expect((desktop as unknown as { config: Record<string, unknown> }).config).toMatchObject({
        transport: "stdio",
        serverName: "agent_desktop",
        command: "agent-desktop",
        args: ["mcp"],
      });
    } finally {
      await app.dispose();
    }
  });

  it("configure 改 args：装出来的配置真的变了，没改的字段仍是默认值", async () => {
    const app = await bootstrapApplication({
      providers: [
        { provide: ToolRegistry as never, useValue: toolRegistryStub },
        ...provideAgentUse(
          configure(AgentBrowserUse, {
            args: ["mcp", "--headed"],
            env: { AGENT_BROWSER_SESSION: "ci" },
          }),
        ),
      ],
      timeoutMs: 8_000,
    });
    try {
      expect(
        (app.get(AgentBrowserUse as never) as unknown as { config: Record<string, unknown> })
          .config,
      ).toMatchObject({
        serverName: "agent_browser",
        command: "agent-browser",
        args: ["mcp", "--headed"],
        env: { AGENT_BROWSER_SESSION: "ci" },
      });
      // 另一条不受影响。
      expect(
        (app.get(AgentDesktopUse as never) as unknown as { config: Record<string, unknown> })
          .config,
      ).toMatchObject({
        args: ["mcp"],
      });
    } finally {
      await app.dispose();
    }
  });

  it("缺 bin 不失败：装配照常完成，两行都在", async () => {
    // 命令指向必然不存在的可执行文件：ENOENT 由上游按 failOnStartupError: false 吞掉。
    const app = await bootstrapApplication({
      providers: [
        { provide: ToolRegistry as never, useValue: toolRegistryStub },
        ...provideAgentUse(
          configure(AgentBrowserUse, {
            command: "dsh-agent-use-missing-browser-bin",
          }),
          configure(AgentDesktopUse, {
            command: "dsh-agent-use-missing-desktop-bin",
          }),
        ),
      ],
      timeoutMs: 8_000,
    });
    try {
      expect(app.get(AgentBrowserUse as never)).toBeInstanceOf(AgentBrowserUse);
      expect(app.get(AgentDesktopUse as never)).toBeInstanceOf(AgentDesktopUse);
    } finally {
      await app.dispose();
    }
  });
});
