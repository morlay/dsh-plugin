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
import type { ToolExecutor } from "@deepseek-ai/dsh-tools";
import * as ContextAssembler from "@morlay/dsh-context-assembler";
import { afterEach, describe, expect, it } from "vitest";
import { SHORT_TOOL_DESCRIPTIONS, TOOL_GROUPS } from "../guidance/groups.ts";
import * as plugin from "../index.ts";

// `base` 的常驻注入：身份是上游 `skill-invocation`，幂等键就是组 skill 名（它不带 id）。
const BASE_SKILL = "tool-group-baseline";

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
  "skill",
];

// 上游注册在 preset 作用域的工具说明：由各组回收清单收进 skill 正文。
const EXPLANATIONS: readonly (readonly [string, string])[] = [
  ["tool:read", "READ_GUIDE"],
  ["tool:goal", "GOAL_GUIDE"],
  ["tool:subagent", "SUBAGENT_GUIDE"],
];

// PTC 形态的替身执行器：注册表里工具一个不少，但模型面只声明 `run_code`（其余只能从程序里
// `await tools.name(...)` 调）——与上游 `@deepseek-ai/dsh-tool-executor-ptc` 的 `describe()` 同形。
function ptcExecutor(): ToolExecutor {
  return {
    // 上游那条 `tools:ptc-only`（`PTC_ONLY_INSTRUCTION`）：装配期的判据就是它。
    sections: [
      {
        name: "tools:ptc-only",
        order: 0,
        interpolate: false,
        text: "`run_code` is the only tool you can call directly.",
      },
    ],
    describe: () => ({
      schemas: [
        {
          name: "run_code",
          description: "运行程序",
          parameters: {
            type: "object",
            properties: { code: { type: "string" } },
            required: ["code"],
          },
        },
      ],
      knownNames: ["run_code"],
    }),
    execute: async () => ({ results: [], additionalContexts: [], concluded: false }),
  };
}

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
  ptc = false,
): Promise<Agent> {
  const key = { preset };
  const standing = createScope(ctx, key);
  await mountToolRows(standing.ctx, toolNames);
  // PTC 换的是这一层的执行器（root 那份由 testkit 装着原生的，同层不能有两个）。
  if (ptc)
    await standing.ctx.plugin(
      Object.assign(
        (inner: Context) => {
          inner.tools.setExecutor(ptcExecutor());
        },
        { inject: ["tools"] },
      ),
    );
  await standing.ctx.plugin(plugin, config);
  const handle = await ctx.agents.create({
    sessionId: SessionId(`tool-guidance-${preset}-${Date.now()}-${Math.random()}`),
    setup: async (agentCtx: Context) => {
      bindScopeParent(scopeOf(agentCtx)!, key);
    },
  });
  return handle.agent;
}

// 真装配的三件：通道、模式行（收口在它内部）、说明行（工具行是这个用例的替身）。
async function mount(
  options: {
    preset?: string;
    tools?: readonly string[];
    config?: plugin.Config;
    ptc?: boolean;
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
  // 注入判据只读"模式收窄后的工具名"：用一个最小服务替掉真实的 session-mode（避免包间循环依赖）。
  // 判据是"收窄后的注册表"：这里等价于不收窄，但**实时**读（晚注册的工具也要算）。
  ctx.provide("sessionModes", {
    knownToolsOf: (scope: Agent) => ctx.tools.definitions(scope).map((entry) => entry.name),
  } as never);
  return {
    ctx,
    agent: await mountStanding(
      ctx,
      options.preset ?? "standard",
      options.tools ?? PRESET_TOOLS,
      options.config,
      options.ptc === true,
    ),
  };
}

async function assembly(ctx: Context, agent: Agent) {
  return ctx.systemPrompt.assemble(assembleContextFor(agent));
}

// 模型目录 = 注册表视图（收窄落在 `tools.restrict` 上，装配瀑布里不再带工具声明）。
function visibleSchemas(ctx: Context, agent: Agent) {
  return ctx.tools.schemas(agent);
}

// 工具投影直接改在**工具定义**上（请求对象是上游冻结的，不能在那里写），所以模型面的
// description / parameters 从定义视图读。
function projectedTools(ctx: Context, agent: Agent) {
  return ctx.tools.definitions(agent);
}

async function toolDescription(
  ctx: Context,
  agent: Agent,
  name: string,
): Promise<string | undefined> {
  return projectedTools(ctx, agent).find((tool) => tool.name === name)?.description;
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
    {
      messages,
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
      modelSelection: { provider: "fixture", model: "fixture" },
    },
    async () => ({ kind: "enter" as const, messages }),
  );
  return decision.kind === "enter" ? decision.messages : [];
}

// 本步注入里 `name` 那份正文（含信封）；没有则空数组。
function injectedBodies(messages: readonly UserMessage[], name?: string): string[] {
  return messages
    .filter((message) => {
      const injected = injectedNameOf(message);
      return injected !== undefined && (name === undefined || injected === name);
    })
    .map(textOf);
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

describe("工具目录", () => {
  it("全部工具都在目录里，分组不裁剪 schema", async () => {
    const { ctx, agent } = await mount();
    const names = visibleSchemas(ctx, agent).map((tool) => tool.name);

    for (const tool of TOOL_GROUPS.flatMap((group) => group.tools.map((entry) => entry.tool))) {
      if (PRESET_TOOLS.includes(tool)) expect(names).toContain(tool);
    }
  });

  it("上游的长描述在请求投影里被换成中文短描述，执行不受影响", async () => {
    const { ctx, agent } = await mount();

    expect(await toolDescription(ctx, agent, "read")).toBe(SHORT_TOOL_DESCRIPTIONS["read"]);
    const batch = await ctx.tools.execute({
      calls: [
        {
          type: "tool-call",
          id: ToolCallId("call-read"),
          name: "read",
          arguments: JSON.stringify({ target: "a" }),
        },
      ],
      agent,
      signal: new AbortController().signal,
    });
    expect(batch.results[0]?.result.error).toBeUndefined();
  });

  it("参数描述整段丢弃（语义在组 skill 正文里），执行不受影响", async () => {
    const { ctx, agent } = await mount();
    const projected = JSON.stringify(
      projectedTools(ctx, agent).find((tool) => tool.name === "read")?.parameters,
    );

    // 说明性字段占常驻 schema 的大头：投影里连键都不留。
    for (const key of ["description", "title", "examples"]) {
      expect(projected).not.toContain(`"${key}"`);
    }
    // 约束照旧：type 与 enum 都在（enum 是校验的一部分，不剥）。
    expect(projected).toContain('"type":"string"');
    expect(projected).toContain('"enum":["a","b"]');

    // 执行期校验用的是 `defineTool` 闭包里那份原 schema：模型面瘦身不影响调用。
    const batch = await ctx.tools.execute({
      calls: [
        {
          type: "tool-call",
          id: ToolCallId("call-read-slim"),
          name: "read",
          arguments: JSON.stringify({ target: "a" }),
        },
      ],
      agent,
      signal: new AbortController().signal,
    });
    expect(batch.results[0]?.result.error).toBeUndefined();
  });

  it("就地改工具定义：注册表里那份描述与参数就是模型看到的那份", async () => {
    // 在 agent 作用域重新注册同名工具会同步触发 `tools/change`，而上游 tool-subagent 用该事件做
    // composition reconcile——两边互相触发会让装配风暴式重入（曾把 session 创建卡死）。
    // 现在改写直接落在定义对象上（`agent/created` 时按该会话的视图改），不注册新定义、不发事件。
    const { ctx, agent } = await mount();
    const definition = ctx.tools.get("read", agent);

    expect(definition?.description).toBe(SHORT_TOOL_DESCRIPTIONS["read"]);
    expect(JSON.stringify(definition?.parameters)).not.toContain('"description"');
  });
});

describe("用法说明的分发（注册进官方 skill 注册表）", () => {
  it("按需的三组各一个组 skill：官方注册表列得出来、拿得到正文", async () => {
    const { ctx, agent } = await mount();

    // 组 skill 只在**对应工具真的注册**时出现：这个装配没有 plan/swarm/mcp 的工具，所以一个都没有。
    expect(await modelSkills(ctx, agent)).toEqual([]);
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

    expect(messages.map((message) => message.source.kind)).toContain("skill-invocation");
    const injected = messages.find((message) => injectedNameOf(message) === BASE_SKILL)!;
    expect(injected.source).toMatchObject({
      kind: "skill-invocation",
      name: BASE_SKILL,
      form: "instructions",
    });
    const text = textOf(injected);
    expect(text.startsWith("<system-reminder>\n\n")).toBe(true);
    expect(text.endsWith("\n\n</system-reminder>")).toBe(true);
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
      {
        messages: [claimed],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
        modelSelection: { provider: "fixture", model: "fixture" },
      },
      async () => ({ kind: "enter" as const, messages: [claimed, trailing] }),
    );
    if (decision.kind !== "enter") throw new Error("expected enter");

    // 多组各注入一条：位置在"本步认领的消息之后、末尾那条之前"。
    const kinds = decision.messages.map((message) =>
      injectedNameOf(message) === undefined ? textOf(message) : "injected",
    );
    expect(kinds[0]).toBe(textOf(claimed));
    expect(kinds.at(-1)).toBe(textOf(trailing));
    expect(kinds.slice(1, -1)).toContain("injected");
  });

  it("第二步不重发（surface 上同键最近一条的正文逐字相等）", async () => {
    const { ctx, agent } = await mount();

    expect((await step(ctx, agent, "任务")).length).toBeGreaterThan(0);
    expect(await step(ctx, agent, "继续")).toEqual([]);
  });

  it("压缩掉那条注入后补发（模型真的看不到了）", async () => {
    const { ctx, agent } = await mount();
    expect((await step(ctx, agent, "任务")).length).toBeGreaterThan(0);

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
    expect((await step(ctx, agent, "任务")).length).toBeGreaterThan(0);
    expect(await step(ctx, agent, "继续")).toEqual([]);

    agent.ctx.tools.register(fixtureTool("bash"));

    const body = (await step(ctx, agent, "再继续")).join("\n");
    expect(body).toContain("- bash：");
  });

  it("PTC 会话：run_code 豁免，其余工具在程序内可用，用法照列", async () => {
    // 两层：模型面只有 `run_code`，但其余工具经 `run_code` 代理在程序内可调——所以注入判据用
    // 「注册表 ∩ 模式收窄」（`sessionModes.knownToolsOf`），`run_code` 单独豁免补上。
    const { ctx, agent } = await mount({ ptc: true });

    const body = (await step(ctx, agent, "任务")).join("\n");

    expect(body).toContain("- run_code：");
    expect(body).toContain("- read：");
    expect(body).toContain("- bash：");
  });

  it("不收窄的会话：基础动作那几行都在（上一条的成对另一半）", async () => {
    const { ctx, agent } = await mount();

    const body = (await step(ctx, agent, "任务")).join("\n");
    if (body === undefined) throw new Error("没有注入 base 正文");
    expect(body).toContain("- read：读文本文件");
    expect(body).toContain("- write：");
    expect(body).toContain("- bash：");
  });

  it("groups: false 时既不注册组 skill 也不注入（工具预处理照旧）", async () => {
    const { ctx, agent } = await mount({ config: { groups: false } });

    expect(await modelSkills(ctx, agent)).toEqual([]);
    expect(injectedBodies(await preStep(ctx, agent, [prompt("任务")]))).toEqual([]);
    expect(await toolDescription(ctx, agent, "read")).toBe(SHORT_TOOL_DESCRIPTIONS["read"]);
  });
});
