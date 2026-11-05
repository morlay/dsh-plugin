// PTC 装配下 `describe_tool` 必须真的注册在工具注册表里——骨架（`renderSkeleton`）在 system 里
// 承诺了它，模型在程序里一定会调；没注册时上游把调用当未知工具拒掉，模型只能瞎猜参数。
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { defineTool } from "@morlay/dsh-agent/contract";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { SessionMode } from "@morlay/session-mode";
import { sessionModeTestProviders } from "./support/session-mode-providers.ts";
import { afterEach, describe, expect, it } from "vitest";
import { pinDshHome } from "./support/dsh-home.ts";

pinDshHome();

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/** 一条只为占位的工具：`describe_tool` 的 entries 从注册表现取。 */
function toolOf(name: string) {
  return defineTool({
    name,
    description: `上游对 ${name} 的说明。`,
    parameters: {},
    output: { schema: { type: "string" }, render: () => [] },
    execute: async () => "ok",
  });
}

describe("PTC：describe_tool 是常驻工具", () => {
  it("按会话收口之后，注册表里有 describe_tool", async () => {
    const app = await bootstrapApplication({
      // headless 测试装配：骨架 + 会话 + 投影 + 执行器 + 循环本体 + 通道/模式（**不含 wire**）。
      providers: sessionModeTestProviders(),
      timeoutMs: 30_000,
    });
    opened.push(app);
    const tools = app.get(ToolRegistry);
    for (const name of ["read", "bash"]) tools.register(toolOf(name));
    const agent = await app
      .get(AgentLoop)
      .create(SessionId(`describe-tool-${String(Math.random())}`), {
        provider: "deepseek-official",
        model: "deepseek-flash",
      });
    // PTC 的判据是"执行器在场"：装一个最小的（注册 `tools:ptc-only` 并把模型面收成 `run_code`）。
    (agent.ctx as unknown as { tools: ToolRegistry }).tools.setExecutor({
      sections: [
        {
          name: "tools:ptc-only",
          order: 800,
          text: "只有 run_code 能直接调。",
          interpolate: false,
        },
      ],
      describe: () => ({ schemas: [], knownNames: ["run_code"] }),
      execute: async () => ({ results: [], additionalContexts: [], concluded: true }),
    });
    app.get(SessionMode).applyTo(agent, "coding", { record: false });

    expect(tools.definitions(agent).map((tool) => tool.name)).toContain("describe_tool");
  });
});
