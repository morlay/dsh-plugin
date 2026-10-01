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
import * as ContextAssembler from "@morlay/dsh-context-assembler";
import * as sessionModePlugin from "@morlay/dsh-session-mode";
import type { Config, SessionMode } from "@morlay/dsh-session-mode";
import { afterEach, describe, expect, it } from "vitest";
import {
  BASE_GROUP_KEY,
  SHORT_TOOL_DESCRIPTIONS,
  TOOL_GROUPS,
  skillNameOf,
} from "../guidance/groups.ts";
import * as plugin from "../index.ts";

// `base` 的常驻注入：身份是上游 `skill-invocation`，幂等键就是组 skill 名（它不带 id）。
const BASE_SKILL = skillNameOf(BASE_GROUP_KEY);

function injectedNameOf(message: { readonly source: unknown }): string | undefined {
  const { kind, name } = message.source as { readonly kind?: unknown; readonly name?: unknown };
  return kind === "skill-invocation" && typeof name === "string" ? name : undefined;
}

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

// 上游工具行的替身：描述刻意写长，用来验证本插件把它换成了短描述。
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

// 标准模式装配里会出现的工具集合。
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

// 上游注册在 preset 作用域的工具说明：由各组回收清单收进 skill 正文。
const EXPLANATIONS: readonly (readonly [string, string])[] = [
  ["tool:read", "READ_GUIDE"],
  ["tool:goal", "GOAL_GUIDE"],
  ["tool:subagent", "SUBAGENT_GUIDE"],
];

// 在某个 scope 上装载「工具行 + 工具说明 section」，形状与上游 preset 装配一致。
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

async function mountStanding(
  ctx: Context,
  preset: string,
  toolNames: readonly string[],
  config?: plugin.Config,
): Promise<Agent> {
  const key = { preset };
  const standing = createScope(ctx, key);
  await mountToolRows(standing.ctx, toolNames);
  await standing.ctx.plugin(plugin, config);
  const handle = await ctx.agents.create({
    sessionId: SessionId(`tool-guidance-${preset}-${Date.now()}-${Math.random()}`),
    setup: async (agentCtx: Context) => {
      bindScopeParent(scopeOf(agentCtx)!, key);
    },
  });
  return handle.agent;
}

// 一份模式定义：只有收口要的那几项在用例里写出来，其余给 schema 的缺省值。
function modeOf(name: string, overrides: Partial<SessionMode> = {}): SessionMode {
  return {
    preset: "",
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

// 会话级收口的两个模式：`full` 是新会话的起点（不设收窄、要指令），`chat` 就是部署里 chat 的形状
// （白名单三件 + `instructions: false`）。收窄那侧的用例靠按需 `applyTo(agent, "chat")` 表达——那是真收窄，
// 落在装配投影与执行 guard 上；别的用例的会话照旧是不收窄的 `full`。
const MODES: Config = {
  default: "full",
  modes: {
    full: modeOf("完整模式"),
    chat: modeOf("对话模式", {
      allowTools: ["ask_user_question", "web_search", "web_fetch"],
      instructions: false,
    }),
  },
};

// 真装配的三件：通道、模式行（收口在它内部）、说明行（工具行是这个用例的替身）。
async function mount(
  options: {
    preset?: string;
    tools?: readonly string[];
    config?: plugin.Config;
  } = {},
) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
  });
  await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(ContextAssembler);
  await ctx.plugin(sessionModePlugin, MODES);
  return {
    ctx,
    agent: await mountStanding(
      ctx,
      options.preset ?? "standard",
      options.tools ?? PRESET_TOOLS,
      options.config,
    ),
  };
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

// 走真实的 pre-step 通道：先 assemble（reminder 在那里捕获），再让瀑布注入。
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

// 本步注入里 `name` 那份正文（含信封）；没有则空数组。
function injectedBodies(messages: readonly UserMessage[], name = BASE_SKILL): string[] {
  return messages.filter((message) => injectedNameOf(message) === name).map(textOf);
}

// 走一步、并把这一步注入的正文落进会话（loop 的落库动作）。
async function step(ctx: Context, agent: Agent, said: string): Promise<string[]> {
  const decided = await preStep(ctx, agent, [prompt(said)]);
  const bodies = injectedBodies(decided);
  for (const message of decided) {
    if (injectedNameOf(message) !== undefined) {
      agent.session.append("user/message", message, { surfaceOp: "append" });
    }
  }
  return bodies;
}

// 进模型目录的 skill 名：模型可以按需加载它们。
async function modelSkills(ctx: Context, agent: Agent): Promise<string[]> {
  const skills = await ctx.skills.list({ scope: agent });
  return skills.filter((skill) => skill.invocation.modelInvocable).map((skill) => skill.name);
}

async function skillContent(ctx: Context, agent: Agent, skillName: string): Promise<string> {
  const skill = await ctx.skills.get(skillName, { scope: agent });
  return skill?.content ?? "";
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

describe("用法说明的分发（注册进官方 skill 注册表）", () => {
  it("按需的三组各一个组 skill：官方注册表列得出来、拿得到正文", async () => {
    const { ctx, agent } = await mount();

    expect((await modelSkills(ctx, agent)).toSorted()).toEqual(
      [skillNameOf("delegation"), skillNameOf("flow"), skillNameOf("team")].toSorted(),
    );

    const flow = await skillContent(ctx, agent, skillNameOf("flow"));
    expect(flow).toContain("- todo_write：多步任务");
    // 上游原文不再拼进正文（要点已吸收进中文列表）。
    expect(flow).not.toContain("GOAL_GUIDE");

    const delegation = await skillContent(ctx, agent, skillNameOf("delegation"));
    expect(delegation).toContain("- subagent：派发子代理");
    expect(delegation).not.toContain("SUBAGENT_GUIDE");
  });

  it("base 不进官方目录：它的正文已经在手上，列出来只会让模型再加载一遍", async () => {
    const { ctx, agent } = await mount();

    expect(await modelSkills(ctx, agent)).not.toContain(BASE_SKILL);
    expect(await ctx.skills.get(BASE_SKILL, { scope: agent })).toBeUndefined();
  });

  it("上游逐工具说明不进系统提示词", async () => {
    const { ctx, agent } = await mount();
    const rendered = renderPrompt(await assembly(ctx, agent));

    for (const [, guide] of EXPLANATIONS) expect(rendered).not.toContain(guide);
  });
});

describe("base 组正文的常驻注入", () => {
  it("首步注入一次：内容块信封、source 是上游 skill-invocation、正文是中文列表", async () => {
    const { ctx, agent } = await mount();
    const messages = await preStep(ctx, agent, [prompt("任务")]);

    expect(messages.map((message) => message.source.kind)).toEqual(["user", "skill-invocation"]);
    const injected = messages[1]!;
    expect(injected.source).toMatchObject({
      kind: "skill-invocation",
      name: BASE_SKILL,
      form: "instructions",
    });
    const text = textOf(injected);
    expect(text.startsWith(`<skill_content name="${BASE_SKILL}">\n<skill_instructions>\n`)).toBe(
      true,
    );
    expect(text.endsWith("</skill_instructions>\n</skill_content>")).toBe(true);
    expect(text).toContain("- read：读文本文件");
    // 手写信封：不带官方 `renderSkillContent` 的 `<skill_resources>` 段（虚拟 skill 没有资源目录）。
    expect(text).not.toContain("<skill_resources>");
    // 上游原文不拼进来。
    expect(text).not.toContain("READ_GUIDE");
  });

  it("落点在本步认领的用户消息之后，不是列表末尾", async () => {
    // 末尾那个位置归官方 `tool-skill` 的目录、上游的 runtime context：我们不动它们。
    const { ctx, agent } = await mount();
    const claimed = prompt("任务");
    const trailing = prompt("末尾那条（别的监听者追加的）");
    await ctx.systemPrompt.assemble(assembleContextFor(agent));

    const decision = await agentEvents(ctx, agent).waterfall(
      "agent/pre-step",
      { messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: "enter" as const, messages: [claimed, trailing] }),
    );
    if (decision.kind !== "enter") throw new Error("expected enter");

    expect(decision.messages.map(textOf)).toEqual([
      textOf(claimed),
      expect.stringContaining(`<skill_content name="${BASE_SKILL}">`),
      textOf(trailing),
    ]);
  });

  it("第二步不重发（surface 上同键最近一条的正文逐字相等）", async () => {
    const { ctx, agent } = await mount();

    expect(await step(ctx, agent, "任务")).toHaveLength(1);
    expect(await step(ctx, agent, "继续")).toEqual([]);
  });

  it("压缩掉那条注入后补发（模型真的看不到了）", async () => {
    const { ctx, agent } = await mount();
    expect(await step(ctx, agent, "任务")).toHaveLength(1);

    // 压缩：早期的 surface 节点被一条摘要顶上，那条注入不再在 surface 上。
    const injectedSeq = agent.session.surface.nodes.find((seq) => {
      const event = agent.session.eventAt(seq);
      return event?.type === "user/message" && injectedNameOf(event.data) === BASE_SKILL;
    });
    if (injectedSeq === undefined) throw new Error("surface 上没有注入节点");
    agent.session.append("user/message", prompt("RECOVERY CHECKPOINT"), {
      surfaceOp: { op: "replace", startSeq: injectedSeq, endSeq: injectedSeq },
      sourceEventSeqs: [injectedSeq],
    });
    const onSurface = (): boolean =>
      agent.session.surface.nodes.some((seq) => {
        const event = agent.session.eventAt(seq);
        return event?.type === "user/message" && injectedNameOf(event.data) === BASE_SKILL;
      });
    expect(onSurface()).toBe(false);

    expect(await step(ctx, agent, "继续")).toHaveLength(1);
    expect(onSurface()).toBe(true);
  });

  it("正文随装配目录变化重发：装了新工具就追加一条新的", async () => {
    const { ctx, agent } = await mount({ tools: ["read"] });
    expect(await step(ctx, agent, "任务")).toHaveLength(1);
    expect(await step(ctx, agent, "继续")).toEqual([]);

    agent.ctx.tools.register(fixtureTool("bash"));

    const [body] = await step(ctx, agent, "再继续");
    expect(body).toContain("- bash：执行命令");
  });

  it("正文按这个会话装配结果的最终目录过滤：收窄掉的工具那几行不在", async () => {
    // 真收窄：preset 装着全套工具（standard），会话把工具收窄到提问 + 联网三件（chat 的白名单形态）。
    const { ctx, agent } = await mount();
    ctx.sessionModes.applyTo(agent, "chat", { record: false });

    expect((await assembly(ctx, agent)).tools.map((tool) => tool.name).toSorted()).toEqual([
      "ask_user_question",
      "web_fetch",
      "web_search",
    ]);

    const [body] = await step(ctx, agent, "任务");
    if (body === undefined) throw new Error("没有注入 base 正文");
    // `instructions: false` 收不住这条正文（本行读不到那个开关）：正文照旧送达，只是按目录过滤过。
    expect(body).toContain("- ask_user_question：");
    expect(body).toContain("- web_search：");
    expect(body).toContain("- web_fetch：");
    // 被收窄掉的那些行不列——注册表里它们还在（收窄不改注册表）。
    for (const gone of [
      "read：",
      "write：",
      "edit：",
      "glob：",
      "grep：",
      "bash：",
      "后台任务",
      "read_image：",
      "skill：",
    ]) {
      expect(body).not.toContain(gone);
    }
  });

  it("不收窄的会话：基础动作那几行都在（上一条的成对另一半）", async () => {
    const { ctx, agent } = await mount();

    const [body] = await step(ctx, agent, "任务");
    if (body === undefined) throw new Error("没有注入 base 正文");
    expect(body).toContain("- read：读文本文件");
    expect(body).toContain("- write：");
    expect(body).toContain("- bash：执行命令");
  });

  it("还没有装配记录的 agent 退回注册表判据（兜底，不是空正文）", async () => {
    // 正常路径上 `agent/pre-step` 之前必有一次装配（loop 里先 `assemble` 再走这条瀑布）；这条用例直接走瀑布，
    // 钉住兜底那半边：读不到装配目录时按注册表过滤，而不是什么都不列。
    const { ctx, agent } = await mount({ tools: ["read", "bash"] });
    const claimed = prompt("任务");

    const decision = await agentEvents(ctx, agent).waterfall(
      "agent/pre-step",
      { messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: "enter" as const, messages: [claimed] }),
    );
    if (decision.kind !== "enter") throw new Error("expected enter");
    const [body] = injectedBodies(decision.messages);
    if (body === undefined) throw new Error("没有注入 base 正文");

    expect(body).toContain("- read：读文本文件");
    expect(body).toContain("- bash：执行命令");
    expect(body).not.toContain("web_search：");
  });

  it("groups: false 时既不注册组 skill 也不注入（工具预处理照旧）", async () => {
    const { ctx, agent } = await mount({ config: { groups: false } });

    expect(await modelSkills(ctx, agent)).toEqual([]);
    expect(injectedBodies(await preStep(ctx, agent, [prompt("任务")]))).toEqual([]);
    expect(await toolDescription(ctx, agent, "web_search")).toBe(
      SHORT_TOOL_DESCRIPTIONS["web_search"],
    );
  });
});
