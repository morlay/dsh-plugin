// tool-policy 域的局部闭环：真 `repeat-tool-reminder` / `tool-call-timeout-policy` /
// `compaction-image-offload` / `mcp-resources` 四条行 + 真工具注册表与会话栈。
//
// 四条行都是「挂在工具调用生命周期上的策略」，不登记工具、也不声明自己的契约：判据只能是
// 「它们要的依赖真的都在、并且行装得上」——其中 `McpResources` 有自己的服务令牌，用它当证据。
import McpResourceRuntime from "@deepseek-ai/dsh-mcp-resources";
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentDirectoryDefault, SystemPromptDefault, ToolRegistryDefault } from "@morlay/dsh-agent/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideToolPolicy } from "@morlay/dsh-tool-policy";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    
      SystemPromptDefault,
      ToolRegistryDefault,
      AgentDirectoryDefault,
      ...provideToolPolicy(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("tool-policy 域", () => {
  it("四条策略行装得上：MCP 资源行的服务令牌能解析，工具注册表仍在", { timeout: 20_000 }, async () => {
    const app = await boot();
    expect(app.get(McpResourceRuntime)).toBeInstanceOf(McpResourceRuntime);
    expect(app.get(ToolRegistry)).toBeDefined();
  });
});
