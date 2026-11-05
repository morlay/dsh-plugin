// MCP 工具的按需分组：`mcp__<server>__<tool>` 默认不进目录，`tool_group_load` 放行一组后下一步可见。
// 判据走**模式**的入口（`ctx.sessionModes.applyTo`）——与部署里那条路同一个接缝。
import { Context } from "@deepseek-ai/cordis";
import { assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";
import type { Config, SessionMode } from "../modes.ts";
import { deniedByList, toolGroupOf } from "../shared.ts";
import { groupTools } from "../tool-groups.ts";

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

function modeOf(name: string, overrides: Partial<SessionMode> = {}): SessionMode {
  return {
    presetsOnly: [],
    name,
    description: "",
    role: ["main"],
    persona: { prefix: "", suffix: "" },
    allowTools: [],
    denyTools: [],
    allowSkills: [],
    denySkills: [],
    allowPolicies: [],
    denyPolicies: [],
    instructions: true,
    runtimeContext: true,
    ...overrides,
  };
}

const CONFIG: Config = {
  default: "open",
  modes: {
    open: modeOf("开放模式"),
    listed: modeOf("白名单模式", { allowTools: ["read"] }),
  },
};

function fixtureTool(toolName: string) {
  return defineTool({
    name: toolName,
    description: `上游对 ${toolName} 的说明。`,
    parameters: {},
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    execute: async () => "ok",
  });
}

// 常驻组的样本（文件 / shell / 技能 / 流程）与按需组的样本（联网 / 每个 MCP server）。
const RESIDENT_TOOLS = ["read", "bash", "skill", "todo_write"];
const TOOLS = [
  ...RESIDENT_TOOLS,
  "web_search",
  "web_fetch",
  "mcp__browser__open",
  "mcp__browser__click",
  "mcp__desktop__snapshot",
];

async function mount(): Promise<{
  ctx: Context;
  agent: (id: string) => Promise<Agent>;
}> {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
  });
  await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        for (const toolName of TOOLS) inner.tools.register(fixtureTool(toolName));
      },
      { inject: ["tools"] },
    ),
  );
  await ctx.plugin(plugin, CONFIG);
  return {
    ctx,
    agent: async (id) =>
      (
        await ctx.agents.create({
          sessionId: SessionId(`session-mode-groups-${id}-${String(Math.random())}`),
        })
      ).agent,
  };
}

function apply(ctx: Context, agent: Agent, modeId: string): void {
  ctx.sessionModes.applyTo(agent, modeId, { record: false });
}

async function visibleTools(ctx: Context, agent: Agent): Promise<string[]> {
  return ctx.tools
    .schemas(agent)
    .map((tool) => tool.name)
    .toSorted();
}

// 只看按需面：常驻组与控制工具不在断言里，免得被它们的增减牵动。
async function visibleOnDemand(ctx: Context, agent: Agent): Promise<string[]> {
  const resident = new Set([...RESIDENT_TOOLS, "tool_group_list", "tool_group_load"]);
  return (await visibleTools(ctx, agent)).filter((name) => !resident.has(name));
}

async function callTool(
  ctx: Context,
  agent: Agent,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<{ error?: string; text?: string }> {
  const batch = await ctx.tools.execute({
    calls: [
      {
        type: "tool-call",
        id: ToolCallId(`call-${name}-${String(Math.random())}`),
        name,
        arguments: JSON.stringify(arguments_),
      },
    ],
    agent,
    signal: new AbortController().signal,
  });
  const result = batch.results[0]?.result;
  if (result === undefined) return {};
  if ("error" in result) return { error: result.error.message };
  const blocks = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return { text: blocks.map((block) => block.text ?? "").join("") };
}

describe("按需工具分组", () => {
  it("只收按需组：常驻组（文件 / shell / 技能 / 流程）不进这张表", () => {
    expect([
      ...groupTools([
        "read",
        "bash",
        "skill",
        "todo_write",
        "ask_user_question",
        "web_search",
        "web_fetch",
        "workflow",
        "mcp__a__x",
        "mcp__a__y",
        "mcp__b__z",
      ]),
    ]).toEqual([
      ["group:web", ["web_search", "web_fetch"]],
      ["group:workflow", ["workflow"]],
      ["mcp:a", ["mcp__a__x", "mcp__a__y"]],
      ["mcp:b", ["mcp__b__z"]],
    ]);
  });
});

describe("按需组默认不进目录", () => {
  it("常驻组一直在目录里，按需组一个都不在", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("open");
    apply(ctx, session, "open");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect(await visibleTools(ctx, session)).toEqual(
      [...RESIDENT_TOOLS, "tool_group_list", "tool_group_load"].toSorted(),
    );
  });

  it("load 一组后该组可见、别组仍不可见", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("open");
    apply(ctx, session, "open");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const listed = await callTool(ctx, session, "tool_group_list", {});
    expect(listed.error).toBeUndefined();
    expect(listed.text).toContain("mcp:browser");
    expect(listed.text).toContain("mcp:desktop");
    expect(listed.text).toContain("group:web");

    const loaded = await callTool(ctx, session, "tool_group_load", { group: "mcp:browser" });
    expect(loaded.error).toBeUndefined();
    expect(await visibleOnDemand(ctx, session)).toEqual([
      "mcp__browser__click",
      "mcp__browser__open",
    ]);

    await callTool(ctx, session, "tool_group_load", { group: "desktop" });
    expect(await visibleOnDemand(ctx, session)).toEqual([
      "mcp__browser__click",
      "mcp__browser__open",
      "mcp__desktop__snapshot",
    ]);

    // 非 MCP 的按需组同样要放行；`group:` 前缀可省。
    await callTool(ctx, session, "tool_group_load", { group: "web" });
    expect(await visibleOnDemand(ctx, session)).toEqual([
      "mcp__browser__click",
      "mcp__browser__open",
      "mcp__desktop__snapshot",
      "web_fetch",
      "web_search",
    ]);
    // 放行别的组不牵动常驻组。
    expect(await visibleTools(ctx, session)).toContain("bash");
  });

  it("放行之后真的能调用（不只是目录里看得见）", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("open");
    apply(ctx, session, "open");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect((await callTool(ctx, session, "web_search", {})).error).toContain("unknown tool");
    await callTool(ctx, session, "tool_group_load", { group: "group:web" });
    expect((await callTool(ctx, session, "web_search", {})).error).toBeUndefined();
  });

  it("认不出的组给出错误，不放行任何工具", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("open");
    apply(ctx, session, "open");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const loaded = await callTool(ctx, session, "tool_group_load", { group: "nope" });

    expect(loaded.error).toBeUndefined();
    expect(loaded.text).toContain("unknown tool group");
    expect(await visibleOnDemand(ctx, session)).toEqual([]);
  });

  it("设了白名单的模式不做按需：没有控制工具，也没多出 MCP 工具", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("listed");
    apply(ctx, session, "listed");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect(await visibleTools(ctx, session)).toEqual(["read"]);
  });
});

describe("工具按用途分组", () => {
  it("按用途分组，MCP 仍按 server 分组", () => {
    expect(toolGroupOf("read")).toBe("fs");
    expect(toolGroupOf("working_directory")).toBe("fs");
    expect(toolGroupOf("bash")).toBe("shell");
    expect(toolGroupOf("web_search")).toBe("web");
    expect(toolGroupOf("skill")).toBe("skill");
    expect(toolGroupOf("present")).toBe("feedback");
    expect(toolGroupOf("todo_write")).toBe("feedback");
    expect(toolGroupOf("ask_user_question")).toBe("feedback");
    expect(toolGroupOf("plan_mode")).toBe("plan");
    expect(toolGroupOf("schedule_task")).toBe("schedule");
    expect(toolGroupOf("spawn_teammate")).toBe("collab");
    expect(toolGroupOf("wait_agent")).toBe("collab");
    expect(toolGroupOf("interrupt_agent")).toBe("collab");
    expect(toolGroupOf("workflow")).toBe("workflow");
    expect(toolGroupOf("get_goal")).toBe("workflow");
    expect(toolGroupOf("update_goal")).toBe("workflow");
    expect(toolGroupOf("mcp__agent-browser__open")).toBe("mcp:agent-browser");
  });
});

describe("名单里的组引用", () => {
  it("写组 id 等于命中组内每一个工具", () => {
    expect(deniedByList(["mcp:agent-browser"], "mcp__agent-browser__open")).toBe(true);
    expect(deniedByList(["mcp:agent-browser"], "mcp__agent-desktop__desktop_snapshot")).toBe(false);
    expect(deniedByList(["group:schedule"], "schedule_task")).toBe(true);
    expect(deniedByList(["group:plan"], "plan_mode")).toBe(true);
    expect(deniedByList(["group:fs"], "read")).toBe(true);
    expect(deniedByList(["group:fs"], "web_search")).toBe(false);
  });

  it("写具体工具名只命中它自己", () => {
    expect(deniedByList(["mcp__agent-browser__open"], "mcp__agent-browser__open")).toBe(true);
    expect(deniedByList(["mcp__agent-browser__open"], "mcp__agent-browser__click")).toBe(false);
  });
});
