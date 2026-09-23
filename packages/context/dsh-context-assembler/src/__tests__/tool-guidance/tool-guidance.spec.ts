import { Context } from "@deepseek-ai/cordis";
import { agentEvents, assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { ToolCallId, createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import { SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import { defineTool } from "@deepseek-ai/dsh-tools";
import * as ContextAssembler from "../../assembler/index.ts";
import * as SkillCatalog from "../../skill-catalog/index.ts";
import * as ContextScope from "../../scope/index.ts";
import { afterEach, describe, expect, it } from "vitest";
import { SHORT_TOOL_DESCRIPTIONS, TOOL_GROUPS, skillNameOf } from "../../tool-guidance/groups.ts";
import * as plugin from "../../tool-guidance/index.ts";

/** 通道注入的条目：幂等键在 source 的 `id` 上（kind 会随注入方声明而不同）。 */
function entryIdOf(message: { readonly source: unknown }): string | undefined {
  const id = (message.source as { readonly id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

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
    parameters: {
      target: {
        type: "string",
        required: true,
        enum: ["a", "b"],
        title: `${toolName} target`,
        examples: ["a", "b"],
        description: `上游对 ${toolName}.target 的说明：它是什么、什么时候给、有哪些边界要注意。`,
      },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    execute: async () => "ok",
  });
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
  "web_search",
  "skill",
  "todo_write",
  "exit_plan_mode",
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

/** 上游注册在 preset 作用域的工具说明：由各组回收清单收进 skill 正文。 */
const EXPLANATIONS: readonly (readonly [string, string])[] = [
  ["tool:read", "READ_GUIDE"],
  ["tool:goal", "GOAL_GUIDE"],
  ["tool:subagent", "SUBAGENT_GUIDE"],
];

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

async function mountStanding(ctx: Context, preset: string): Promise<Agent> {
  const key = { preset };
  const standing = createScope(ctx, key);
  await mountToolRows(standing.ctx, PRESET_TOOLS);
  await standing.ctx.plugin(plugin);
  const handle = await ctx.agents.create({
    sessionId: SessionId(`tool-guidance-${preset}-${Date.now()}-${Math.random()}`),
    setup: async (agentCtx: Context) => {
      bindScopeParent(scopeOf(agentCtx)!, key);
    },
  });
  return handle.agent;
}

async function mount(preset = "standard") {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
  });
  await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(ContextAssembler);
  return { ctx, agent: await mountStanding(ctx, preset) };
}

async function assembly(ctx: Context, agent: Agent) {
  return ctx.systemPrompt.assemble(assembleContextFor(agent));
}

async function toolDescription(
  ctx: Context,
  agent: Agent,
  name: string,
): Promise<string | undefined> {
  return (await assembly(ctx, agent)).tools.find((tool) => tool.name === name)?.description;
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
}

function textOf(message: UserMessage): string {
  const [block] = message.content;
  return block?.type === "text" ? block.text : "";
}

function idOf(message: UserMessage): string | undefined {
  return entryIdOf(message);
}

function bodyOf(messages: readonly UserMessage[], id: string): string {
  const message = messages.find((candidate) => idOf(candidate) === id);
  return message === undefined ? "" : textOf(message);
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

/** 进模型目录的 skill 名：模型可以按需加载它们。 */
async function modelSkills(ctx: Context, agent: Agent): Promise<string[]> {
  const skills = await ctx.skills.list({ scope: agent });
  return skills.filter((skill) => skill.invocation.modelInvocable).map((skill) => skill.name);
}

async function skillContent(ctx: Context, agent: Agent, skillName: string): Promise<string> {
  const skill = await ctx.skills.get(skillName, { scope: agent });
  return skill?.content ?? "";
}

/** 走 `skill` 工具按需加载（用户可见的接缝），而不是直读注册表。 */
async function loadSkill(ctx: Context, agent: Agent, skillName: string): Promise<string> {
  const result = await ctx.tools.execute({
    callId: ToolCallId(`call-${skillName}`),
    name: "skill",
    arguments: { name: skillName },
    agent,
    signal: new AbortController().signal,
  });
  const value = (result as { value?: { content?: unknown } }).value;
  if (typeof value?.content !== "string")
    throw new Error(`skill tool returned no content: ${skillName}`);
  return value.content;
}

describe("工具目录", () => {
  it("全部工具都在目录里，分组不裁剪 schema", async () => {
    const { ctx, agent } = await mount();
    const names = (await assembly(ctx, agent)).tools.map((tool) => tool.name);

    for (const tool of TOOL_GROUPS.flatMap((group) => group.tools)) {
      if (PRESET_TOOLS.includes(tool)) expect(names).toContain(tool);
    }
  });

  it("上游的长描述在装配投影里被换成中文短描述，执行不受影响", async () => {
    const { ctx, agent } = await mount();

    expect(await toolDescription(ctx, agent, "web_search")).toBe(
      SHORT_TOOL_DESCRIPTIONS["web_search"],
    );
    expect(
      await ctx.tools
        .execute({
          callId: ToolCallId("call-read"),
          name: "read",
          arguments: { target: "a" },
          agent,
          signal: new AbortController().signal,
        })
        .then((result) => result.error),
    ).toBeUndefined();
  });

  it("参数描述整段丢弃（语义在组 skill 正文里），注册表不动", async () => {
    const { ctx, agent } = await mount();
    const projected = JSON.stringify(
      (await assembly(ctx, agent)).tools.find((tool) => tool.name === "read")?.parameters,
    );
    const registered = JSON.stringify(ctx.tools.get("read", agent)?.parameters);

    // 说明性字段占常驻 schema 的大头：投影里连键都不留，注册表照旧。
    for (const key of ["description", "title", "examples"]) {
      expect(projected).not.toContain(`"${key}"`);
      expect(registered).toContain(`"${key}"`);
    }
    // 约束照旧：type 与 enum 都在（enum 是校验的一部分，不剥）。
    expect(projected).toContain('"type":"string"');
    expect(projected).toContain('"enum":["a","b"]');
  });

  it("只改装配投影，不碰注册表", async () => {
    // 在 agent 作用域注册同名工具会同步触发 `tools/change`，而上游 tool-subagent 用该事件做
    // composition reconcile——两边互相触发会让装配风暴式重入（曾把 session 创建卡死）。
    const { ctx, agent } = await mount();

    expect(ctx.tools.get("web_search", agent)?.description).not.toBe(
      SHORT_TOOL_DESCRIPTIONS["web_search"],
    );
    expect(await toolDescription(ctx, agent, "web_search")).toBe(
      SHORT_TOOL_DESCRIPTIONS["web_search"],
    );
  });
});

describe("用法说明的分发", () => {
  it("base 组正文随首步 reminder 自动注入：一份中文用法列表", async () => {
    const { ctx, agent } = await mount();

    const injected = bodyOf(await preStep(ctx, agent, [prompt("任务")]), skillNameOf("base"));

    // 常驻送达的 skill 正文与按需加载同一形态：内容块，不是规则块。
    expect(injected).toMatch(/^<skill_content name="tool-group-base">/);
    expect(injected).not.toContain("skill_resources");
    expect(injected).toContain("- read：读文本文件");
    // 上游原文不再拼进正文（要点已吸收进中文列表）。
    expect(injected).not.toContain("READ_GUIDE");
    expect(injected).not.toContain("【基础】");
  });

  it("flow / delegation / team 进 skill 目录按需加载，base 不进目录", async () => {
    const { ctx, agent } = await mount();

    expect(await modelSkills(ctx, agent)).toEqual([
      skillNameOf("delegation"),
      skillNameOf("flow"),
      skillNameOf("team"),
    ]);

    const flow = await skillContent(ctx, agent, skillNameOf("flow"));
    expect(flow).toContain("- todo_write：多步任务");
    expect(flow).not.toContain("GOAL_GUIDE");

    const delegation = await skillContent(ctx, agent, skillNameOf("delegation"));
    expect(delegation).toContain("- subagent：派发子代理");
    expect(delegation).not.toContain("SUBAGENT_GUIDE");

    const teams = await skillContent(ctx, agent, skillNameOf("team"));
    expect(teams).toContain("- spawn_teammate：派发队友");
  });

  it("上游逐工具说明不进系统提示词", async () => {
    const { ctx, agent } = await mount();
    const rendered = renderPrompt(await assembly(ctx, agent));

    for (const [, guide] of EXPLANATIONS) expect(rendered).not.toContain(guide);
  });

  it("同一 skill 名只注册一次，两份分发互不覆盖", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
    });
    await mountAgentLoopTestHarness(ctx);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(ContextAssembler);

    const first = await mountStanding(ctx, "standard");
    const second = await mountStanding(ctx, "chat");

    for (const agent of [first, second]) {
      expect(bodyOf(await preStep(ctx, agent, [prompt("任务")]), skillNameOf("base"))).toContain(
        "- read：读文本文件",
      );
      expect(await modelSkills(ctx, agent)).toEqual([
        skillNameOf("delegation"),
        skillNameOf("flow"),
        skillNameOf("team"),
      ]);
    }
  });
});

describe("模式只给一部分工具时（chat 形态）", () => {
  it("base 正文只讲这些工具，其余的行消失", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个助手。" },
    });
    await mountAgentLoopTestHarness(ctx);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(ContextAssembler);

    const key = { preset: "chat" };
    const standing = createScope(ctx, key);
    // 只装三个工具：正文该跟着短（同一个 base 组，工具只是其中一部分）。
    await mountToolRows(standing.ctx, ["ask_user_question", "web_search", "web_fetch"]);
    await standing.ctx.plugin(plugin, { groups: true });
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-guidance-chat-${Date.now()}`),
      setup: async (agentCtx: Context) => {
        bindScopeParent(scopeOf(agentCtx)!, key);
      },
    });

    const body = bodyOf(await preStep(ctx, handle.agent, [prompt("任务")]), skillNameOf("base"));

    expect(body).toContain("web_search：");
    expect(body).toContain("ask_user_question：");
    expect(body).not.toContain("read：");
    expect(body).not.toContain("bash：");
    expect(body).not.toContain("后台任务");
  });

  it("按需加载的组正文也按会话修剪（注册表里只有一份全量）", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个助手。" },
    });
    await mountAgentLoopTestHarness(ctx);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(ContextAssembler);
    await ctx.plugin(SkillCatalog);

    const key = { preset: "chat" };
    const standing = createScope(ctx, key);
    // 只装派发组里的两个控制工具：组仍在目录里（入口工具可见），但正文不该讲没装的那些。
    await mountToolRows(standing.ctx, ["send_message", "list_agents"]);
    await standing.ctx.plugin(plugin, { groups: true });
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-guidance-on-demand-${Date.now()}`),
      setup: async (agentCtx: Context) => {
        bindScopeParent(scopeOf(agentCtx)!, key);
      },
    });

    const loaded = await loadSkill(ctx, handle.agent, skillNameOf("delegation"));

    expect(loaded).toContain("send_message：");
    expect(loaded).not.toContain("subagent：");
    expect(loaded).not.toContain("workflow：");
  });
});

describe("技能也跟着工具走", () => {
  /**
   * 只装这几个工具（preset 作用域）并把白名单收在同一作用域，返回该会话的技能目录正文：
   * 目录本身就是注入通道的一条规则块（id `skill-catalog`）。
   */
  async function catalogFor(tools: string[]): Promise<string> {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个助手。" },
    });
    await mountAgentLoopTestHarness(ctx);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(ContextAssembler);
    await ctx.plugin(SkillCatalog);

    const key = { preset: "chat" };
    const standing = createScope(ctx, key);
    await mountToolRows(standing.ctx, tools);
    await standing.ctx.plugin(ContextScope, { allowTools: tools });
    await standing.ctx.plugin(plugin, { groups: true });
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-guidance-requires-${Date.now()}-${Math.random()}`),
      setup: async (agentCtx: Context) => {
        bindScopeParent(scopeOf(agentCtx)!, key);
      },
    });

    return bodyOf(await preStep(ctx, handle.agent, [prompt("任务")]), "skill-catalog");
  }

  const CHAT_TOOLS = ["ask_user_question", "web_search", "web_fetch"];

  it("依赖的工具都没装时，该组的 skill 不进技能目录", async () => {
    // 三个对话工具 + 一个子代理控制工具：flow 组（todo_write / goal / present）一个都没装，
    // Agent Teams 也没装——`send_message` 是子代理控制行提供的同名工具，不是 team 组的入口。
    const body = await catalogFor([...CHAT_TOOLS, "send_message"]);

    expect(body).toContain("tool-group-delegation");
    expect(body).not.toContain("tool-group-team");
    expect(body).not.toContain("tool-group-flow");
    // base 是 auto（正文随提示常驻），本来就不进技能目录。
    expect(body).not.toContain("tool-group-base");
  });

  it("装了团队插件独有的入口工具，team 组才进技能目录", async () => {
    const body = await catalogFor([
      ...CHAT_TOOLS,
      "send_message",
      "spawn_teammate",
      "team_task_create",
      "wait_agent",
    ]);

    expect(body).toContain("tool-group-team");
    expect(body).toContain("tool-group-delegation");
  });
});
