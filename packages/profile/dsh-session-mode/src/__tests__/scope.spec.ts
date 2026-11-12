// 按会话收口（`SessionModes` 内部持有的那一份）：模式定义推进去之后，这个会话的工具目录、`tool:<工具名>` 说明
// section、执行层 guard、通道开关与动态快照各自收成什么样。收口不发布服务，所以判据走**模式**（`ctx.sessionModes`
// 的 `applyTo`）——与部署里的那条路同一个入口。

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
import { pinDshHome } from "./dsh-home.ts";

// 用例里的模式定义就是被测输入：把 `{dshHome}/modes/*.toml` 指到空目录，别让开发机上真用户的覆盖参与装配。
pinDshHome();

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

// 一个模式定义：只有收口要的那几项（两份名单、`instructions` / `runtimeContext`）在用例里写出来，`skills` 不写、
// 留给按名单推导，其余给 schema 的缺省值。
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

const THREE = ["ask_user_question", "web_search", "web_fetch"] as const;

// 部署里会装的六个模式：宽、窄、关掉两类注入的那份、留空白名单（不设收窄）、只给黑名单、两条名单同配。
const MODES: Record<string, SessionMode> = {
  // 默认模式：两条名单都空 = 不过滤（新会话的起点，也是"没收口"的对照）。
  nothing: modeOf("无名单模式"),
  wide: modeOf("标准模式", { allowTools: [...THREE] }),
  narrow: modeOf("窄模式", { allowTools: ["ask_user_question"] }),
  // 模式配置的 `dropSections`：精确名 + `*` 前缀两种写法。
  trimmed: modeOf("裁剪模式", {
    allowTools: [...THREE],
    dropSections: ["team:policy", "tool:read"],
  }),
  silent: modeOf("静默模式", {
    allowTools: ["ask_user_question"],
    instructions: false,
    runtimeContext: false,
  }),
  denyOnly: modeOf("排除模式", { denyTools: ["send_message", "list_agents"] }),
  // 名单里只有**本 agent 自己**注册的工具（preset 行提供的那种）：`tools.restrict` 只认全局名。
  localDeny: modeOf("本地排除模式", { denyTools: ["local_only"] }),
  allowAndDeny: modeOf("优先模式", { allowTools: [...THREE], denyTools: ["web_fetch"] }),
};

const CONFIG: Config = { default: "nothing", modes: MODES };

// 通道被调用的记录：本行与通道之间是 duck-typed 的服务契约。
interface ChannelCall {
  readonly kind: "instructions";
  readonly agent: Agent;
  readonly value: unknown;
}

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

// 在 host 平面装工具行：与 `dsh.profile.bundles` 列出 `tool-guidance` 时的形状一致。
async function mountTools(scope: Context, toolNames: readonly string[]): Promise<void> {
  await scope.plugin(
    Object.assign(
      (inner: Context) => {
        for (const toolName of toolNames) inner.tools.register(fixtureTool(toolName));
      },
      { inject: ["tools"] },
    ),
  );
}

// 上游工具说明 section 的形状：工具行自己注册一条 `tool:<name>`（`tools:` 那类是聚合块）。
async function mountSection(scope: Context, name: string, text: string): Promise<void> {
  await scope.plugin(
    Object.assign(
      (inner: Context) => {
        inner.systemPrompt.section({ name, order: 1, text });
      },
      { inject: ["systemPrompt"] },
    ),
  );
}

// 上游 `sandbox-policy` / `user-approval` 的形状：host 层注册一条动态快照。
async function mountSnapshot(scope: Context, text: string): Promise<void> {
  await scope.plugin(
    Object.assign(
      (inner: Context) => {
        inner.systemPrompt.context({ name: "sandbox:policy", order: 1, text });
      },
      { inject: ["systemPrompt"] },
    ),
  );
}

interface MountOptions {
  // host 平面装了哪些工具（默认：白名单之外的几件也装着，用来验证收口）。
  readonly tools?: readonly string[];
  // `false` 时先不装模式行（用来建一个"没收过口"的会话：行在它之后才激活）。
  readonly withModes?: boolean;
}

async function mount(options: MountOptions = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
  });
  await mountAgentLoopTestHarness(ctx);

  const calls: ChannelCall[] = [];
  // 通道是可选的搭档：这里用记录器替掉它，验证收口确实按那份定义拨了那个开关。
  ctx.provide("contextAssembler", {
    setInstructions: (agent: Agent, on: boolean) => {
      calls.push({ kind: "instructions", agent, value: on });
    },
  } as unknown as Context["contextAssembler"]);

  // host 平面装的是全套工具（白名单里的三件 + 白名单之外的两件）：收口才是被测的那件事。
  await mountTools(
    ctx,
    options.tools ?? [
      "ask_user_question",
      "web_search",
      "web_fetch",
      "send_message",
      "list_agents",
    ],
  );
  await mountSnapshot(ctx, "Current DSH file policy: workspace-write.");

  const agent = async (id: string): Promise<Agent> =>
    (
      await ctx.agents.create({
        sessionId: SessionId(`session-mode-scope-${id}-${String(Math.random())}`),
      })
    ).agent;

  const withModes = options.withModes ?? true;
  // 模式行：收口是它内部持有的那一份。
  if (withModes) await ctx.plugin(plugin, CONFIG);

  return {
    ctx,
    calls,
    agent,
    // 会话建立之后才激活模式行：这个会话没收过口（"没登记过的会话一律放行"就是这一形态）。
    activate: async (): Promise<void> => {
      await ctx.plugin(plugin, CONFIG);
    },
  };
}

// 换一份收口：走模式自己的入口（`applyTo` 不要求空白会话，与子代理继承同一个接缝）。
function apply(ctx: Context, agent: Agent, modeId: string): void {
  ctx.sessionModes.applyTo(agent, modeId, { record: false });
}

async function visibleTools(ctx: Context, agent: Agent): Promise<string[]> {
  // `describe_tool` 是本插件在 PTC 下常驻的控制工具，不参与"模式收窄"的断言。
  // 收窄落在注册表视图上（`tools.restrict`）：目录与执行读的是同一份。
  return ctx.tools
    .schemas(agent)
    .map((tool) => tool.name)
    .filter((name) => name !== "describe_tool")
    .toSorted();
}

async function sectionNames(ctx: Context, agent: Agent): Promise<string[]> {
  return (await ctx.systemPrompt.assemble(assembleContextFor(agent))).sections.map(
    (section) => section.name,
  );
}

// 一次工具调用的文本结果（`describe_tool` 这类返回文本的工具用它读输出）。
async function callToolText(
  ctx: Context,
  agent: Agent,
  name: string,
  args: unknown,
  callId: string,
): Promise<string> {
  const batch = await ctx.tools.execute({
    calls: [{ type: "tool-call", id: ToolCallId(callId), name, arguments: JSON.stringify(args) }],
    agent,
    signal: new AbortController().signal,
  });
  return JSON.stringify(batch.results[0]?.result ?? {});
}
async function callTool(ctx: Context, agent: Agent, name: string, callId: string) {
  // 程序化调用走批量形状（上游 0.2.1-rc.2 起 `execute` 只收批量）；这里每次就一件。
  const batch = await ctx.tools.execute({
    calls: [{ type: "tool-call", id: ToolCallId(callId), name, arguments: "{}" }],
    agent,
    signal: new AbortController().signal,
  });
  const result = batch.results[0]?.result;
  return { error: result !== undefined && "error" in result ? result.error : undefined };
}

describe("工具白名单（按会话收口）", () => {
  it("只留白名单里的工具，host 层多出来的进不了目录", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("wide");
    apply(ctx, session, "wide");
    // 收窄在 `tools` 的 inject 回调里注册：先走一步装配，等它跑过。
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect(await visibleTools(ctx, session)).toEqual([
      "ask_user_question",
      "web_fetch",
      "web_search",
    ]);
  });

  it("白名单之外的工具说明 section 不留在提示词里，聚合 section 照旧", async () => {
    const { ctx, agent } = await mount();
    await mountSection(ctx, "tool:ask_user_question", "问答说明");
    await mountSection(ctx, "tool:send_message", "发消息说明");
    // 聚合 section（`tools:` 前缀）不是单个工具的说明，不受白名单管。
    await mountSection(ctx, "tools:sdk", "工具集说明");
    const session = await agent("wide");
    apply(ctx, session, "wide");

    const names = await sectionNames(ctx, session);

    expect(names).toContain("tool:ask_user_question");
    expect(names).toContain("tools:sdk");
    expect(names).not.toContain("tool:send_message");
  });

  it("没收过口的会话一律放行（行在它之后才激活的部署照旧）", async () => {
    const { ctx, agent, activate } = await mount({ withModes: false });
    const session = await agent("free");
    await activate();

    expect(ctx.sessionModes.modeOf(session.session)).toBe("nothing");
    expect(await visibleTools(ctx, session)).toEqual([
      "ask_user_question",
      "list_agents",
      "send_message",
      "web_fetch",
      "web_search",
    ]);
  });

  it("名单里含只在本 agent 注册的工具时不抛：收窄降级到全局那一层", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("local-deny");
    // preset 行注册的工具落在 agent scope（不是全局层）：面板上「禁止」它就是这种名单。
    session.ctx.tools.register(fixtureTool("local_only"));

    // 改前这里抛 `tools.restrict() names unknown global tool "local_only"`（线上 409 之外的另一种崩）。
    expect(() => { apply(ctx, session, "localDeny"); }).not.toThrow();
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    // 降级只影响"收窄"这一层：全局工具照旧在目录里。
    expect(await visibleTools(ctx, session)).toContain("ask_user_question");
  });

  it("白名单之外的工具调用不了：不在准入集里，直接是 UNKNOWN_TOOL", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("narrow");
    apply(ctx, session, "narrow");
    // 收窄在收口里注册（等 tools 激活）：先走一步装配。
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const denied = await callTool(ctx, session, "web_fetch", "call-denied");
    const allowed = await callTool(ctx, session, "ask_user_question", "call-allowed");

    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("unknown tool");
    expect(allowed.error).toBeUndefined();
  });

  it("按需组的工具照样可调用：组只决定说明怎么送达，不决定能不能调", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("on-demand-call");
    // `nothing` 两条名单都空 = 不设收窄。
    apply(ctx, session, "nothing");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    // web-access 是 `on-demand` 组（正文不常驻注入），它的工具必须照样能调。
    expect(await visibleTools(ctx, session)).toContain("web_search");
    expect((await callTool(ctx, session, "web_search", "call-ondemand")).error).toBeUndefined();
  });

  it("带 `when` 条件的工具：准入集之外不列进 describe_tool 清单", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("when-gated");
    // 一个带 `when` 的工具：条件为假时它既不可执行，也不该出现在清单里。
    session.ctx.tools.register(
      defineTool({
        name: "todo_write",
        description: "待办",
        parameters: {},
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: value }],
        },
        execute: async () => "ok",
      }),
      { when: () => false },
    );
    apply(ctx, session, "nothing");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    // 模拟 agent loop 的调用形状：先把这一步的准入集算出来，再带着它调工具。
    const toolSet = await ctx.tools.resolve({
      agent: session,
      modelSelection: { provider: "p", model: "m" } as never,
      signal: new AbortController().signal,
    });
    const batch = await ctx.tools.execute({
      calls: [
        { type: "tool-call", id: ToolCallId("describe-when"), name: "describe_tool", arguments: "{}" },
      ],
      agent: session,
      toolSet,
      signal: new AbortController().signal,
    });
    toolSet.dispose();
    const listed = JSON.stringify(batch.results[0]?.result ?? {});
    // plan 组里只有关着条件的 todo_write：准入集之外，所以这个组根本不该出现在清单里。
    expect(listed).not.toContain("plan —");
  });
  it("`describe_tool` 的清单里每个名字都真的可调用", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("describe-consistency");
    apply(ctx, session, "nothing");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const listed = await callToolText(ctx, session, "describe_tool", {}, "describe-list");
    // 清单只列按需组：`init` 组（ask）不列，`on-demand` 组（web-access / swarm）列。
    expect(listed).toContain("web-access");
    expect(listed).toContain("swarm");
    expect(listed).not.toContain("ask —");

    // 逐个组取签名，再逐个名字验证可调用——这是"展示面 = 可调用面"的核心判据。
    for (const group of ["web-access", "swarm"]) {
      const declaration = await callToolText(
        ctx,
        session,
        "describe_tool",
        { group },
        `describe-${group}`,
      );
      for (const [, name] of declaration.matchAll(/^\s+"?([A-Za-z0-9_-]+)"?\(args:/gm)) {
        const call = await callTool(ctx, session, name!, `${name}-call`);
        expect(call.error).toBeUndefined();
      }
    }
  });
  it("换个模式就是换一份：新的白名单生效，旧收窄被收回", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("switch");
    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_search", "call-wide")).error).toBeUndefined();

    apply(ctx, session, "narrow");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect(await visibleTools(ctx, session)).toEqual(["ask_user_question"]);
    expect((await callTool(ctx, session, "web_search", "call-narrow")).error).toBeDefined();

    // 换回宽的：只收新收窄不收旧收窄的话，这里会仍然被拒。
    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_search", "call-back")).error).toBeUndefined();
  });
});

describe("instructions 与动态快照开关", () => {
  it("缺省为要：通道拿到 true", async () => {
    const { ctx, calls, agent } = await mount();
    const session = await agent("wide");
    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    // 两份定义都没写 `instructions`（schema 的缺省是 true）→ 换过去之后通道拿到的是 true。
    expect(calls.filter((call) => call.agent === session).at(-1)).toEqual({
      kind: "instructions",
      agent: session,
      value: true,
    });
  });

  it("instructions: false 时通道被关；runtimeContext: false 时只有这个会话看不到动态快照", async () => {
    const { ctx, calls, agent } = await mount();
    const silent = await agent("silent");
    const wide = await agent("wide");
    apply(ctx, silent, "silent");
    apply(ctx, wide, "wide");

    expect((await ctx.systemPrompt.assemble(assembleContextFor(silent))).contexts).toEqual([]);
    expect((await ctx.systemPrompt.assemble(assembleContextFor(wide))).contexts).toHaveLength(1);
    expect(calls.filter((call) => call.kind === "instructions" && call.value === false)).toEqual([
      { kind: "instructions", agent: silent, value: false },
    ]);
  });
});

describe("工具黑名单（与白名单合成）", () => {
  it("只给黑名单：目录与工具说明 section 都扣掉那几件", async () => {
    const { ctx, agent } = await mount();
    await mountSection(ctx, "tool:send_message", "发消息说明");
    await mountSection(ctx, "tool:web_search", "搜索说明");
    const session = await agent("deny-only");
    apply(ctx, session, "denyOnly");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    // 黑名单只扣掉它点名的那两件：按需组（web-access）的工具照旧可见——组只决定说明怎么送达。
    expect(await visibleTools(ctx, session)).toEqual([
      "ask_user_question",
      "web_fetch",
      "web_search",
    ]);
    expect(await sectionNames(ctx, session)).not.toContain("tool:send_message");
    // `web_search` 属于按需组（web-access）：工具本身可调用，但它的说明只在 `describe_tool` 里现取，
    // 不进系统提示——这正是"按需"的含义。
    expect(await sectionNames(ctx, session)).not.toContain("tool:web_search");
  });

  it("黑名单里的工具调用不了：同样不在准入集里（UNKNOWN_TOOL）", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("deny-call");
    apply(ctx, session, "denyOnly");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const denied = await callTool(ctx, session, "send_message", "call-denied");
    const allowed = await callTool(ctx, session, "ask_user_question", "call-allowed");

    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("unknown tool");
    expect(allowed.error).toBeUndefined();
  });

  it("两条名单同配时黑名单优先：白名单里的名字也能被拒", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("allow-and-deny");
    apply(ctx, session, "allowAndDeny");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    // 白名单里的三件减掉黑名单那一件。
    expect(await visibleTools(ctx, session)).toEqual(["ask_user_question", "web_search"]);

    const denied = await callTool(ctx, session, "web_fetch", "call-deny-wins");
    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("unknown tool");
  });

  it("两条都空：全部工具照旧可见", async () => {
    const { ctx, agent } = await mount();
    await mountSection(ctx, "tool:send_message", "发消息说明");
    const session = await agent("no-lists");
    apply(ctx, session, "nothing");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    // 两条名单都空 = 不设收窄：全部工具可见，按需组的工具也不例外。
    expect(await visibleTools(ctx, session)).toEqual([
      "ask_user_question",
      "list_agents",
      "send_message",
      "web_fetch",
      "web_search",
    ]);
  });

  it("从白名单换成白名单 + 黑名单：黑名单生效，旧收窄收回", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("switch-to-deny");
    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_fetch", "call-wide")).error).toBeUndefined();

    apply(ctx, session, "allowAndDeny");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_fetch", "call-denied")).error).toBeDefined();
    // 旧收窄（认 `wide` 那份白名单）已收回：换一份之后仍按新名单判，而不是两份叠加。
    expect(
      (await callTool(ctx, session, "web_search", "call-still-allowed")).error,
    ).toBeUndefined();

    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_fetch", "call-restored")).error).toBeUndefined();
  });
});

// 收口的注册落在 `agent.ctx` 上：那份 effect 归 **agent 的 scope fiber**，不归本行。所以"上一次注册"的收回
// 账必须挂在能被卸载的那一侧——本行（设置保存会让 Loader 重新配置这一行）与 agent 各一份。只记在当前实例里
// （`applied` 那个 WeakMap）的话，行一旦重挂，新实例就没有上一份可收，`describe_tool` 一装就撞名。
describe("收口的归属：行重挂之后重装不撞名", () => {
  it("行卸载时把它在 agent 上的注册一起收掉；新实例重装不会撞上旧的那份", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeHarnessIdentity: false } });
    await mountAgentLoopTestHarness(ctx);
    await mountTools(ctx, ["ask_user_question", "web_search", "send_message"]);

    const row = await ctx.plugin(plugin, CONFIG);
    const { agent: session } = await ctx.agents.create({
      sessionId: SessionId(`session-mode-reload-${String(Math.random())}`),
    });
    apply(ctx, session, "narrow");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect(ctx.tools.schemas(session).map((schema) => schema.name)).toContain("describe_tool");

    // 行重挂（设置页保存会让 Loader 重新配置这一行）：旧注册必须跟着行一起收——收窄放开、`describe_tool` 撤掉。
    await row.dispose();

    // 新实例重新收口：撞名的话这里是 `tool "describe_tool" is already registered in this scope`。
    await ctx.plugin(plugin, CONFIG);
    expect(() => {
      apply(ctx, session, "narrow");
    }).not.toThrow();
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect(await visibleTools(ctx, session)).toEqual(["ask_user_question"]);
  });
});

describe("按需组的说明不进系统提示", () => {
  it("MCP server 的 instructions 与资源清单都靠 describe_tool 现取", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("on-demand-sections");
    // 上游 `mcp-client` 把 server 自己的 instructions 注册成 `mcp:<server>`，`mcp-resources` 注册成
    // `mcp-resource-servers`：两条都属于按需组，不该留在系统提示里。
    await mountSection(ctx, "mcp:agent-browser", "### MCP server: agent-browser");
    await mountSection(ctx, "mcp-resource-servers", "## MCP resource servers");
    // 派发指引（官方 `tool-subagent` 注册的 `tool:subagent`）同样归 swarm 组 —— 按需，不进 sp。
    await mountSection(ctx, "tool:subagent", "Start independent delegations with `subagent`");
    apply(ctx, session, "nothing");

    const names = await sectionNames(ctx, session);
    expect(names).not.toContain("mcp:agent-browser");
    expect(names).not.toContain("mcp-resource-servers");
    expect(names).not.toContain("tool:subagent");
  });

  it("常驻组的说明照旧留在系统提示里（成对判据）", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("resident-sections");
    await mountSection(ctx, "tool:ask_user_question", "问答说明");
    apply(ctx, session, "nothing");

    expect(await sectionNames(ctx, session)).toContain("tool:ask_user_question");
  });
});
describe("按需组的正文靠 describe_tool 送达", () => {
  it("MCP server 自己带的 instructions 出现在 describe 结果里", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("on-demand-texts");
    // 一个 MCP server 的工具 + 它自己的 instructions（上游 `mcp-client` 注册成 `mcp:<server>`）。
    session.ctx.tools.register(fixtureTool("mcp__srv__do"));
    await mountSection(ctx, "mcp:srv", "### MCP server: srv");
    apply(ctx, session, "nothing");
    // 装配一次：按需组的 section 在这一步被摘下来记账。
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const text = await callToolText(ctx, session, "describe_tool", { group: "mcp:srv" }, "d-srv");
    expect(text).toContain("MCP server: srv");
    expect(text).toContain("mcp__srv__do");
  });
});
describe("模式配置的 dropSections", () => {
  it("精确名与 `*` 前缀都会从装配结果里丢弃", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("wide");
    await mountSection(ctx, "team:policy", "TEAM_POLICY");
    apply(ctx, session, "trimmed");
    const names = await sectionNames(ctx, session);
    expect(names).not.toContain("team:policy");
    expect(names).not.toContain("tool:read");
  });
});
