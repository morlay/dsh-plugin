// 工具说明的汉化与用法分组：模型看到的**工具描述**必须是一行中文，
// 而不是上游那几段英文（源包 `tool-guidance` 的运行时干的就是这件事）。
//
// 这条钉两件事：
// 1. 工具定义上的 `description` 被换成 `SHORT_TOOL_DESCRIPTIONS` 里的中文；
// 2. 参数 schema 被精简（剥掉 `description` / `title` 这类说明性字段，语义在组正文里讲一次）。
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { defineTool } from "@morlay/dsh-agent/contract";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { sessionModeTestProviders } from "./support/session-mode-providers.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { UserMessage } from "@morlay/dsh-agent/contract";
import { pinDshHome } from "./support/dsh-home.ts";

/** cordis 的瀑布面（`TestContext` 的类型面不含它，那是模块增强）。 */
interface CordisBus {
  waterfall<R>(name: string, ...args: unknown[]): R;
}

pinDshHome();

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/** 一条带英文描述与参数说明的工具：汉化之后这两处都不该留原样。 */
function readTool() {
  return defineTool({
    name: "read",
    description: "Read text files. NEVER use sed/cat.",
    parameters: {
      file_path: { type: "string", description: "Path to the file", title: "File path" },
    },
    output: { schema: { type: "string" }, render: () => [] },
    execute: async () => "ok",
  });
}

describe("工具说明的汉化", () => {
  it("会话里的工具描述换成一行中文，参数说明被剥掉", async () => {
    const app = await bootstrapApplication({
      // headless 装配清单（不装 wire：端点行要 remote-handlers）。
      providers: [...sessionModeTestProviders()],
      timeoutMs: 30_000,
    });
    opened.push(app);
    const tools = app.get(ToolRegistry);
    tools.register(readTool());
    await app.get(AgentLoop).create(SessionId(`guidance-${String(Math.random())}`), {
      provider: "deepseek-official",
      model: "deepseek-flash",
    });

    const definition = tools.definitions().find((tool) => tool.name === "read");
    expect(definition).toBeDefined();
    // 中文描述（`SHORT_TOOL_DESCRIPTIONS.read`），不是上游那句英文。
    expect(definition?.description).toContain("读文件内容");
    // 参数的说明性字段被剥掉（约束保留）：`defineTool` 会把参数包成 JSON Schema 的 `properties`。
    const params = definition?.parameters as
      | { properties?: { file_path?: Record<string, unknown> } }
      | undefined;
    const filePath = params?.properties?.file_path;
    expect(filePath?.["type"]).toBe("string");
    expect(filePath?.["description"]).toBeUndefined();
    expect(filePath?.["title"]).toBeUndefined();
  });

  it("`init` 组的用法正文随本步注入（一条 reminder，幂等键固定）", async () => {
    const app = await bootstrapApplication({
      // headless 装配清单（不装 wire：端点行要 remote-handlers）。
      providers: [...sessionModeTestProviders()],
      timeoutMs: 30_000,
    });
    opened.push(app);
    const tools = app.get(ToolRegistry);
    tools.register(readTool());
    const agent = await app
      .get(AgentLoop)
      .create(SessionId(`guidance-body-${String(Math.random())}`), {
        provider: "deepseek-official",
        model: "deepseek-flash",
      });

    // 走一步：`agent/pre-step` 的瀑布把 `init` 组的正文作为一条 user 消息追加。
    // 瀑布的最后一参是 `next`（本行之外没有别的监听者，原样放行）。
    const decision = await (agent.ctx as unknown as CordisBus).waterfall<
      Promise<{ kind: "enter"; messages: readonly UserMessage[] }>
    >(
      "agent/pre-step",
      { agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: "enter", messages: [] }),
    );
    const text = decision.messages
      .map((message) =>
        message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
      )
      .join("\n");
    // `fs` 组（`injection: "init"`）的正文，带组标签的信封。
    expect(text).toContain('group="fs"');
    expect(text).toContain("read：读文本文件");
  });
});
