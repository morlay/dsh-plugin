import { Context } from "@deepseek-ai/cordis";
import { agentEvents, assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import Commands from "@deepseek-ai/dsh-commands";
import {
  ToolCallId,
  createToolResultMessage,
  createUserMessage,
  type UserMessage,
} from "@deepseek-ai/dsh-llm";
import { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import { defineTool } from "@deepseek-ai/dsh-tools";
import * as PromptReminder from "@morlay/dsh-prompt-reminder";
import { afterEach, describe, expect, it } from "vitest";
import { ENABLE_TOOLS_NAME, SHORT_TOOL_DESCRIPTIONS, TOOL_GROUPS } from "../groups.ts";
import { LEVEL_COMMAND, unlockedFromSession } from "../index.ts";
import * as plugin from "../index.ts";

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

/** 上游工具行的替身：描述刻意写长，用来验证本插件把它换成了短描述。 */
function fixtureTool(toolName: string) {
  return defineTool({
    name: toolName,
    description:
      `上游对 ${toolName} 的说明：它做什么、什么时候该用、有哪些注意事项，` +
      "长度明显超过本插件的短描述，用来验证覆盖生效。",
    parameters: {},
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    execute: async () => "ok",
  });
}

/** 在某个 scope 上装载「工具行 + 工具说明 section」，形状与上游 preset 装配一致。 */
async function mountToolRows(scope: Context, toolNames: readonly string[]): Promise<void> {
  await scope.plugin(
    Object.assign(
      (inner: Context) => {
        for (const toolName of toolNames) inner.tools.register(fixtureTool(toolName));
        for (const [name, text] of EXPLANATIONS) {
          inner.systemPrompt.section({
            name,
            order: inner.systemPrompt.getSectionOrder("TOOL_SUBAGENT"),
            text,
          });
        }
      },
      { inject: ["tools", "systemPrompt"] },
    ),
  );
}

/** 标准模式装配里会出现的工具集合。 */
const PRESET_TOOLS = [
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "bash",
  "ask_user_question",
  "job_output",
  "job_list",
  "job_kill",
  "read_image",
  "web_fetch",
  "skill",
  "todo_write",
  "exit_plan_mode",
  "web_search",
  "subagent",
  "subagent_fork",
  "list_subagent_models",
  "workflow",
  "spawn_teammate",
  "send_message",
  "list_agents",
  "wait_agent",
  "interrupt_agent",
  "team_task_create",
  "team_task_list",
  "team_task_get",
  "team_task_update",
];

/** 上游注册在 preset 作用域、被本插件统一遮蔽的工具说明。 */
const EXPLANATIONS: readonly (readonly [string, string])[] = [
  ["tool:read", "READ_GUIDE"],
  ["tool:web_search", "WEB_SEARCH_GUIDE"],
  ["tool:workflow", "WORKFLOW_GUIDE"],
];

async function mount(
  options: { initial?: string[]; reminder?: boolean } = {},
): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { personaPrefix: "你是一个编码专家。" },
  });
  await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(Commands);
  if (options.reminder === true) await ctx.plugin(PromptReminder);

  const key = { preset: "standard" };
  const standing = createScope(ctx, key);
  await mountToolRows(standing.ctx, PRESET_TOOLS);
  await standing.ctx.plugin(
    plugin,
    options.initial === undefined ? {} : { initial: options.initial },
  );

  const handle = await ctx.agents.create({
    sessionId: SessionId(`tool-gating-${Date.now()}-${Math.random()}`),
    setup: async (agentCtx: Context) => {
      bindScopeParent(scopeOf(agentCtx)!, key);
    },
  });
  return { ctx, agent: handle.agent };
}

async function assembly(ctx: Context, agent: Agent) {
  return ctx.systemPrompt.assemble(assembleContextFor(agent));
}

async function catalogTools(ctx: Context, agent: Agent): Promise<string[]> {
  return (await assembly(ctx, agent)).tools.map((tool) => tool.name);
}

async function toolDescription(
  ctx: Context,
  agent: Agent,
  name: string,
): Promise<string | undefined> {
  return (await assembly(ctx, agent)).tools.find((tool) => tool.name === name)?.description;
}

async function promptText(ctx: Context, agent: Agent): Promise<string> {
  return renderPrompt(await assembly(ctx, agent));
}

async function callTool(
  ctx: Context,
  agent: Agent,
  name: string,
  args: unknown = {},
): Promise<{ denied: boolean; text: string }> {
  const result = await ctx.tools.execute({
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  });
  return { denied: result.error !== undefined, text: JSON.stringify(result) };
}

async function enable(ctx: Context, agent: Agent, groups: readonly string[]): Promise<void> {
  const result = await callTool(ctx, agent, ENABLE_TOOLS_NAME, { groups });
  expect(result.denied, result.text).toBe(false);
}

async function runLevelCommand(
  ctx: Context,
  agent: Agent,
  line: string,
): Promise<{ kind: string; text?: string } | undefined> {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal);
  return execution?.result;
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
}

function textOf(message: UserMessage): string {
  const [block] = message.content;
  return block?.type === "text" ? block.text : "";
}

/** 走真实的 pre-step 通道：先 assemble（reminder 在那里捕获），再让瀑布注入。 */
async function preStep(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
): Promise<UserMessage[]> {
  await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    { messages, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: "enter" as const, messages }),
  );
  return decision.kind === "enter" ? decision.messages : [];
}

function reminderText(messages: readonly UserMessage[]): string {
  const reminder = messages.findLast((message) => message.source.kind === "prompt-reminder");
  return reminder === undefined ? "" : textOf(reminder);
}

describe("工具目录恒定", () => {
  it("全部工具始终在目录里，档位不裁剪 schema", async () => {
    const { ctx, agent } = await mount();
    const before = await catalogTools(ctx, agent);

    for (const group of TOOL_GROUPS) {
      for (const tool of group.tools) {
        if (PRESET_TOOLS.includes(tool)) expect(before).toContain(tool);
      }
    }
    expect(before).toContain(ENABLE_TOOLS_NAME);

    await enable(ctx, agent, ["web", "team"]);

    // 关键不变式：启用前后 tools 参数逐字相同——这就是缓存稳定的前提。
    expect(await catalogTools(ctx, agent)).toEqual(before);
  });

  it("上游的长描述在装配投影里被换成中文短描述，执行不受影响", async () => {
    const { ctx, agent } = await mount();

    expect(await toolDescription(ctx, agent, "web_search")).toBe(
      SHORT_TOOL_DESCRIPTIONS["web_search"],
    );
    expect(await promptText(ctx, agent)).toContain("联网搜索");

    expect(await callTool(ctx, agent, "read")).toEqual({ denied: false, text: expect.anything() });
  });

  it("只改装配投影，不碰注册表", async () => {
    // 在 agent 作用域注册同名工具会同步触发 `tools/change`，而上游 tool-subagent 用该事件做
    // composition reconcile——两边互相触发会让装配风暴式重入（曾把 session 创建卡死）。
    // 因此注册表里必须仍是上游定义，只有装配投影被改写。
    const { ctx, agent } = await mount();

    expect(ctx.tools.get("web_search", agent)?.description).not.toBe(
      SHORT_TOOL_DESCRIPTIONS["web_search"],
    );
    expect(await toolDescription(ctx, agent, "web_search")).toBe(
      SHORT_TOOL_DESCRIPTIONS["web_search"],
    );
  });
});

describe("档位在执行层生效", () => {
  it("未启用组的工具被拒，并告知属于哪一组、怎么解锁", async () => {
    const { ctx, agent } = await mount();

    const denied = await callTool(ctx, agent, "web_search");

    expect(denied.denied).toBe(true);
    expect(denied.text).toContain("联网检索");
    expect(denied.text).toContain(ENABLE_TOOLS_NAME);
  });

  it("基础组与未归组的工具一开始就能调用", async () => {
    const { ctx, agent } = await mount();

    expect((await callTool(ctx, agent, "read")).denied).toBe(false);
    expect((await callTool(ctx, agent, ENABLE_TOOLS_NAME, { groups: [] })).denied).toBe(false);
  });

  it("启用后放行；启用是并集，重复启用不报错", async () => {
    const { ctx, agent } = await mount();

    await enable(ctx, agent, ["web"]);

    expect((await callTool(ctx, agent, "web_search")).denied).toBe(false);
    expect((await callTool(ctx, agent, "todo_write")).denied).toBe(true);
    expect((await callTool(ctx, agent, "subagent")).denied).toBe(true);

    await enable(ctx, agent, ["web"]);

    expect((await callTool(ctx, agent, "web_search")).denied).toBe(false);
  });

  it("参数里的未知组名被 schema 拒绝，档位不变", async () => {
    const { ctx, agent } = await mount();

    const denied = await callTool(ctx, agent, ENABLE_TOOLS_NAME, { groups: ["nope"] });

    expect(denied.denied).toBe(true);
    expect((await callTool(ctx, agent, "web_search")).denied).toBe(true);
    expect((await callTool(ctx, agent, "read")).denied).toBe(false);
  });

  it("传入已启用的组不改变档位（并集幂等）", async () => {
    const { ctx, agent } = await mount();

    await enable(ctx, agent, ["web"]);
    await enable(ctx, agent, ["web", "base"]);

    expect((await callTool(ctx, agent, "web_search")).denied).toBe(false);
    expect((await callTool(ctx, agent, "todo_write")).denied).toBe(true);
  });

  it("只影响本 preset 的 agent：其他 scope 的 agent 不受档位与短描述约束", async () => {
    const { ctx } = await mount();

    const otherKey = { preset: "ptc" };
    const other = createScope(ctx, otherKey);
    await mountToolRows(other.ctx, ["workflow"]);
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-gating-other-${Date.now()}-${Math.random()}`),
      setup: async (agentCtx: Context) => {
        bindScopeParent(scopeOf(agentCtx)!, otherKey);
      },
    });

    const description = await toolDescription(ctx, handle.agent, "workflow");

    expect(description).not.toBe(SHORT_TOOL_DESCRIPTIONS["workflow"]);
    expect((await callTool(ctx, handle.agent, "workflow")).denied).toBe(false);
  });
});

describe("提示词", () => {
  it("上游逐个工具的说明一律不进提示词，改由按组提示替代", async () => {
    const { ctx, agent } = await mount();
    const text = await promptText(ctx, agent);

    for (const [, guide] of EXPLANATIONS) expect(text).not.toContain(guide);
    expect(text).toContain("【基础】");
    expect(text).not.toContain("【联网检索】");

    await enable(ctx, agent, ["web"]);

    const after = await promptText(ctx, agent);
    for (const [, guide] of EXPLANATIONS) expect(after).not.toContain(guide);
    expect(after).toContain("【联网检索】");
    expect(after).not.toContain("【协作编排】");
  });

  it("能力目录按档位分批：未启用的组只留组 key、标题与用途", async () => {
    const { ctx, agent } = await mount();

    const before = await promptText(ctx, agent);
    expect(before).toContain("基础（base）已启用");
    expect(before).toContain("team 协作编排：");
    expect(before).not.toContain("spawn_teammate");
    expect(before).not.toContain("web_search");

    await enable(ctx, agent, ["team"]);

    const after = await promptText(ctx, agent);
    expect(after).toContain("协作编排（team）已启用");
    expect(after).toContain("spawn_teammate");
    expect(after).not.toContain("web_search");
  });
});

describe("用法提示的注入路径", () => {
  it("启用后，下一步注入的 reminder 里带上该组的用法提示", async () => {
    const { ctx, agent } = await mount({ reminder: true });

    const first = await preStep(ctx, agent, [prompt("任务")]);
    const firstReminder = reminderText(first);

    expect(firstReminder).toContain("【基础】");
    expect(firstReminder).not.toContain("【联网检索】");

    await enable(ctx, agent, ["web"]);

    const second = await preStep(ctx, agent, [prompt("继续")]);

    expect(reminderText(second)).toContain("【联网检索】");
  });

  it("同一档位下不重复注入（reminder 文本没变就跳过）", async () => {
    const { ctx, agent } = await mount({ reminder: true });

    const first = await preStep(ctx, agent, [prompt("任务")]);
    expect(reminderText(first)).toContain("【基础】");

    // 把那条 reminder 落进 surface（loop 在真实运行里就是这么做的）
    const reminder = first.findLast((message) => message.source.kind === "prompt-reminder");
    expect(reminder).toBeDefined();
    agent.session.append("user/message", reminder!, { surfaceOp: "append" });

    const second = await preStep(ctx, agent, [prompt("继续")]);

    expect(second.filter((message) => message.source.kind === "prompt-reminder")).toHaveLength(0);
  });

  it("文档路径两段换成中文，平台运维两段被遮蔽", async () => {
    const { ctx, agent } = await mount({ reminder: true });
    // 按真实注册层补齐：前两段注册在 agent 作用域（file-reference-local 就这么做），
    // 后两段注册在 host 作用域（app-boot 与 web-app bundle 的注入上下文）。
    await agent.ctx.inject(["systemPrompt"], (scope) => {
      scope.systemPrompt.section({
        name: "context:file-reference",
        order: scope.systemPrompt.getSectionOrder("FILE_REFERENCE"),
        text: "Tokens prefixed with @ are workspace paths the user explicitly referenced.",
      });
      scope.systemPrompt.section({
        name: "ui:deliverable-file-references",
        order: scope.systemPrompt.getSectionOrder("DELIVERABLE_FILE_REFERENCES"),
        text: "When you successfully create or modify files, mention the primary outputs.",
      });
    });
    await ctx.inject(["systemPrompt"], (scope) => {
      scope.systemPrompt.section({
        name: "harness:source",
        order: scope.systemPrompt.getSectionOrder("HARNESS_SOURCE"),
        text: "HARNESS_CHECKOUT_MARKER",
      });
      scope.systemPrompt.section({
        name: "app:web-surface",
        order: scope.systemPrompt.getSectionOrder("WEB_SURFACE"),
        text: "WEB_SURFACE_MARKER",
      });
    });

    const reminder = reminderText(await preStep(ctx, agent, [prompt("任务")]));

    // 两段文档路径说明：换成中文，并且确实走到了 reminder（说明本插件在 reminder 内层）。
    expect(reminder).toContain("以 @ 开头");
    expect(reminder).toContain("成功创建或修改文件后");
    expect(reminder).not.toContain("Tokens prefixed with @");
    expect(reminder).not.toContain("When you successfully create or modify files");
    // 两段平台运维说明：被遮蔽，既不进提示词也不进 reminder。
    expect(reminder).not.toContain("HARNESS_CHECKOUT_MARKER");
    expect(reminder).not.toContain("WEB_SURFACE_MARKER");
    expect(await promptText(ctx, agent)).not.toContain("HARNESS_CHECKOUT_MARKER");
  });
});

describe("模式起始档位", () => {
  it("initial 给出的组在会话开始就可用（协作模式）", async () => {
    const { ctx, agent } = await mount({ initial: ["team"] });

    expect((await callTool(ctx, agent, "subagent")).denied).toBe(false);
    expect((await callTool(ctx, agent, "workflow")).denied).toBe(false);
    expect((await callTool(ctx, agent, "web_search")).denied).toBe(true);

    const text = await promptText(ctx, agent);
    expect(text).toContain("协作编排（team）已启用");
    expect(text).toContain("【协作编排】");
    expect(text).not.toContain("【联网检索】");
  });

  it("initial 里的未知组让装配立刻失败", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {});
    await mountAgentLoopTestHarness(ctx);

    await expect(ctx.plugin(plugin, { initial: ["nope"] })).rejects.toThrow(/unknown group/u);
  });
});

describe("slash command 切换档位", () => {
  it("无参数回到基础组，并落一条可重建的切换消息", async () => {
    const { ctx, agent } = await mount({ initial: ["team"] });

    const result = await runLevelCommand(ctx, agent, `/${LEVEL_COMMAND}`);

    expect(result).toEqual({ kind: "success", text: expect.stringContaining("基础") });
    expect((await callTool(ctx, agent, "subagent")).denied).toBe(true);
    expect(unlockedFromSession(agent.session, [])).toEqual([]);
  });

  it("带组名即把档位设为这些组，命令回执与可调用范围一致", async () => {
    const { ctx, agent } = await mount();

    const result = await runLevelCommand(ctx, agent, `/${LEVEL_COMMAND} web flow`);

    expect(result?.kind).toBe("success");
    expect((await callTool(ctx, agent, "web_search")).denied).toBe(false);
    expect((await callTool(ctx, agent, "todo_write")).denied).toBe(false);
    expect((await callTool(ctx, agent, "subagent")).denied).toBe(true);
    expect(unlockedFromSession(agent.session, [])).toEqual(["web", "flow"]);
  });

  it("未知组名报错且不改动档位", async () => {
    const { ctx, agent } = await mount();

    const result = await runLevelCommand(ctx, agent, `/${LEVEL_COMMAND} nope`);

    expect(result?.kind).toBe("error");
    expect((await callTool(ctx, agent, "web_search")).denied).toBe(true);
  });

  it("命令设定会覆盖先前 enable_tools 的启用（切换而不仅是叠加）", async () => {
    const { ctx, agent } = await mount();

    await enable(ctx, agent, ["web"]);
    await runLevelCommand(ctx, agent, `/${LEVEL_COMMAND} team`);

    expect(unlockedFromSession(agent.session, [])).toEqual(["team"]);
    expect((await callTool(ctx, agent, "web_search")).denied).toBe(true);
    expect((await callTool(ctx, agent, "subagent")).denied).toBe(false);
  });

  it("命令切换在重建时保持 last-writer-wins", async () => {
    const { ctx, agent } = await mount();

    await runLevelCommand(ctx, agent, `/${LEVEL_COMMAND} web`);
    await runLevelCommand(ctx, agent, `/${LEVEL_COMMAND} team`);

    expect(unlockedFromSession(agent.session, [])).toEqual(["team"]);
  });
});

interface SeedCall {
  readonly groups: unknown;
  readonly failed?: boolean;
}

/** 造一段会话历史：每次 enable_tools 调用 + 落库结果。 */
function sessionWithCalls(calls: readonly SeedCall[]): Session {
  const session = Session.create(SessionId("gating-rebuild"));
  session.append("turn/start", { turn: 1 });
  calls.forEach((call, index) => {
    const callId = ToolCallId(`rebuild-${String(index)}`);
    session.append("tool/call", {
      turn: 1,
      step: 1,
      callId,
      name: ENABLE_TOOLS_NAME,
      arguments: JSON.stringify(call.groups),
    });
    session.append(
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId,
          content: [{ type: "text", text: "ok" }],
          isError: call.failed === true,
        }),
        ...(call.failed === true ? { error: { name: "ToolError", code: "FAILED" } } : {}),
      },
      { surfaceOp: "append" },
    );
  });
  return session;
}

describe("档位重建", () => {
  it("没有调用时落在起始档位（默认基础组）", () => {
    expect(unlockedFromSession(sessionWithCalls([]), [])).toEqual([]);
    expect(unlockedFromSession(sessionWithCalls([]), ["team"])).toEqual(["team"]);
  });

  it("按历史调用取并集并保序去重", () => {
    const session = sessionWithCalls([
      { groups: { groups: ["web"] } },
      { groups: { groups: ["team", "web"] } },
    ]);

    expect(unlockedFromSession(session, [])).toEqual(["web", "team"]);
  });

  it("失败的调用与无法解析的参数都不计入", () => {
    const session = sessionWithCalls([
      { groups: { groups: ["team"] }, failed: true },
      { groups: "not-an-object" },
      { groups: { groups: ["flow"] } },
    ]);

    expect(unlockedFromSession(session, [])).toEqual(["flow"]);
  });

  it("被 rewind 掉的那次启用不再计入", () => {
    const session = sessionWithCalls([{ groups: { groups: ["web"] } }]);
    const last = session.surface.nodes.at(-1);

    expect(last).toBeDefined();
    session.append(
      "user/message",
      createUserMessage({ content: [{ type: "text", text: "重来" }], source: { kind: "user" } }),
      { surfaceOp: { op: "replace", startSeq: last!, endSeq: last! }, sourceEventSeqs: [last!] },
    );

    expect(unlockedFromSession(session, [])).toEqual([]);
  });

  it("Agent Teams 规则按档位给：team 组未启用时不注入，启用后给中文版", async () => {
    const { ctx, agent } = await mount({ reminder: true });
    // `tool-agent-team` 在 agent 作用域注册它，所以只能改投影（遮蔽会撞同层重名）。
    await agent.ctx.inject(["systemPrompt"], (scope) => {
      scope.systemPrompt.section({
        name: "team:policy",
        order: scope.systemPrompt.getSectionOrder("TEAM_POLICY"),
        text: "TEAM_POLICY_MARKER",
      });
    });

    const before = reminderText(await preStep(ctx, agent, [prompt("任务")]));
    expect(before).not.toContain("TEAM_POLICY_MARKER");
    expect(before).not.toContain("Agent Teams 规则");

    await enable(ctx, agent, ["team"]);

    const after = reminderText(await preStep(ctx, agent, [prompt("继续")]));
    expect(after).toContain("Agent Teams 规则");
    expect(after).toContain("只在用户明确要求时才招募队友");
    expect(after).not.toContain("TEAM_POLICY_MARKER");
  });
});
