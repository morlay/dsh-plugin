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
  silent: modeOf("静默模式", {
    allowTools: ["ask_user_question"],
    instructions: false,
    runtimeContext: false,
  }),
  denyOnly: modeOf("排除模式", { denyTools: ["send_message", "list_agents"] }),
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
  return (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools
    .map((tool) => tool.name)
    .toSorted();
}

async function sectionNames(ctx: Context, agent: Agent): Promise<string[]> {
  return (await ctx.systemPrompt.assemble(assembleContextFor(agent))).sections.map(
    (section) => section.name,
  );
}

async function callTool(ctx: Context, agent: Agent, name: string, callId: string) {
  return await ctx.tools.execute({
    callId: ToolCallId(callId),
    name,
    arguments: {},
    agent,
    signal: new AbortController().signal,
  });
}

describe("工具白名单（按会话收口）", () => {
  it("只留白名单里的工具，host 层多出来的进不了目录", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("wide");
    apply(ctx, session, "wide");

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

  it("白名单之外的工具调用不了，文案说得出是哪一份定义", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("narrow");
    apply(ctx, session, "narrow");
    // guard 在收口里注册（等 tools 激活）：先走一步装配。
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const denied = await callTool(ctx, session, "web_fetch", "call-denied");
    const allowed = await callTool(ctx, session, "ask_user_question", "call-allowed");

    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("窄模式");
    // 拒绝的一类原因：白名单外（另一类是黑名单内，见下面那组用例）。
    expect(JSON.stringify(denied)).toContain("白名单");
    expect(JSON.stringify(denied)).not.toContain("黑名单");
    expect(allowed.error).toBeUndefined();
  });

  it("换个模式就是换一份：新的白名单生效，旧 guard 被收回", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("switch");
    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_search", "call-wide")).error).toBeUndefined();

    apply(ctx, session, "narrow");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect(await visibleTools(ctx, session)).toEqual(["ask_user_question"]);
    expect((await callTool(ctx, session, "web_search", "call-narrow")).error).toBeDefined();

    // 换回宽的：只收新 guard 不收旧 guard 的话，这里会仍然被拒。
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

describe("allowTools 留空 = 全部工具（不设收窄）", () => {
  it("目录与工具说明 section 都不缩", async () => {
    const { ctx, agent } = await mount();
    await mountSection(ctx, "tool:send_message", "发消息说明");
    const session = await agent("all");
    apply(ctx, session, "nothing");

    expect(await visibleTools(ctx, session)).toEqual([
      "ask_user_question",
      "list_agents",
      "send_message",
      "web_fetch",
      "web_search",
    ]);
    expect(await sectionNames(ctx, session)).toContain("tool:send_message");
  });

  it("白名单之外的工具照旧可调用（不装守卫）", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("all-call");
    apply(ctx, session, "nothing");
    // 守卫在收口里注册：先走一步装配，让 `tools` 那边的 inject 回调跑过。
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect((await callTool(ctx, session, "send_message", "call-free")).error).toBeUndefined();
  });

  it("从收窄换到留空：旧守卫收回，工具与 section 都回来", async () => {
    const { ctx, agent } = await mount();
    await mountSection(ctx, "tool:send_message", "发消息说明");
    const session = await agent("back-to-all");
    apply(ctx, session, "narrow");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_search", "call-narrowed")).error).toBeDefined();

    apply(ctx, session, "nothing");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect(await visibleTools(ctx, session)).toHaveLength(5);
    expect(await sectionNames(ctx, session)).toContain("tool:send_message");
    expect((await callTool(ctx, session, "web_search", "call-restored")).error).toBeUndefined();
  });
});

// 收口的合成规则：最终可用 = (白名单留空 ? 全部 : 白名单) − 黑名单；装配投影、`tool:` section 与执行 guard
// 三处读的是同一个合成结果。
describe("工具黑名单（与白名单合成）", () => {
  it("只给黑名单：目录与工具说明 section 都扣掉那几件，别的照旧", async () => {
    const { ctx, agent } = await mount();
    await mountSection(ctx, "tool:send_message", "发消息说明");
    await mountSection(ctx, "tool:web_search", "搜索说明");
    const session = await agent("deny-only");
    apply(ctx, session, "denyOnly");

    expect(await visibleTools(ctx, session)).toEqual([
      "ask_user_question",
      "web_fetch",
      "web_search",
    ]);
    expect(await sectionNames(ctx, session)).not.toContain("tool:send_message");
    expect(await sectionNames(ctx, session)).toContain("tool:web_search");
  });

  it("黑名单里的工具调用不了，文案说黑名单（与白名单外那一类区分开）", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("deny-call");
    apply(ctx, session, "denyOnly");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const denied = await callTool(ctx, session, "send_message", "call-denied");
    const allowed = await callTool(ctx, session, "web_search", "call-allowed");

    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("排除模式");
    expect(JSON.stringify(denied)).toContain("黑名单");
    expect(JSON.stringify(denied)).not.toContain("白名单");
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
    expect(JSON.stringify(denied)).toContain("黑名单");
  });

  it("两条都空 = 不过滤：目录、section 与调用都照旧", async () => {
    const { ctx, agent } = await mount();
    await mountSection(ctx, "tool:send_message", "发消息说明");
    const session = await agent("no-lists");
    apply(ctx, session, "nothing");
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect(await visibleTools(ctx, session)).toHaveLength(5);
    expect(await sectionNames(ctx, session)).toContain("tool:send_message");
    expect((await callTool(ctx, session, "send_message", "call-free")).error).toBeUndefined();
  });

  it("从白名单换成白名单 + 黑名单：黑名单生效，旧守卫收回", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("switch-to-deny");
    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_fetch", "call-wide")).error).toBeUndefined();

    apply(ctx, session, "allowAndDeny");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_fetch", "call-denied")).error).toBeDefined();
    // 旧守卫（认 `wide` 那份白名单）已收回：换一份之后仍按新名单判，而不是两份叠加。
    expect(
      (await callTool(ctx, session, "web_search", "call-still-allowed")).error,
    ).toBeUndefined();

    apply(ctx, session, "wide");
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_fetch", "call-restored")).error).toBeUndefined();
  });
});
