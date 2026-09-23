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
import * as plugin from "../../scope/index.ts";
import type { SessionToolScopeMode } from "../../scope/index.ts";

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

/** 三份收口定义：宽、窄、以及关掉两类注入的那份。 */
const WIDE: SessionToolScopeMode = {
  name: "标准模式",
  allowTools: ["ask_user_question", "web_search", "web_fetch"],
};
const NARROW: SessionToolScopeMode = { name: "窄模式", allowTools: ["ask_user_question"] };
const SILENT: SessionToolScopeMode = {
  name: "静默模式",
  allowTools: ["ask_user_question"],
  instructions: false,
  runtimeContext: false,
};

/** 通道被调用的记录：本行与通道之间是 duck-typed 的服务契约。 */
interface ChannelCall {
  readonly kind: "instructions" | "restrict";
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

/** 在 host 平面装工具行：与 `dsh.profile.bundles` 列出 toolkit 时的形状一致。 */
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

/** 上游工具说明 section 的形状：工具行自己注册一条 `tool:<name>`（`tools:` 那类是聚合块）。 */
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

/** 上游 `sandbox-policy` / `user-approval` 的形状：host 层注册一条动态快照。 */
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
  /** host 平面装了哪些工具（默认：白名单之外的几件，用来验证收口）。 */
  readonly tools?: readonly string[];
  readonly snapshot?: boolean;
}

async function mount(options: MountOptions = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
  });
  await mountAgentLoopTestHarness(ctx);

  const calls: ChannelCall[] = [];
  // 通道是可选的搭档：这里用记录器替掉它，验证这一行确实按那份定义拨了那两个开关。
  ctx.provide("contextAssembler", {
    setInstructions: (agent: Agent, on: boolean) => {
      calls.push({ kind: "instructions", agent, value: on });
    },
    restrictTools: (agent: Agent, allowed: (tool: string) => boolean) => {
      calls.push({ kind: "restrict", agent, value: allowed });
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
  if (options.snapshot ?? true)
    await mountSnapshot(ctx, "Current DSH file policy: workspace-write.");
  await ctx.plugin(plugin);

  const agent = async (id: string): Promise<Agent> =>
    (
      await ctx.agents.create({
        sessionId: SessionId(`context-assembler-scope-${id}-${String(Math.random())}`),
      })
    ).agent;

  return { ctx, calls, agent };
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
    ctx.sessionToolScope.apply(session, WIDE);

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
    ctx.sessionToolScope.apply(session, WIDE);

    const names = await sectionNames(ctx, session);

    expect(names).toContain("tool:ask_user_question");
    expect(names).toContain("tools:sdk");
    expect(names).not.toContain("tool:send_message");
  });

  it("没登记过的会话一律放行（没装模式那层的部署照旧）", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("free");

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
    ctx.sessionToolScope.apply(session, NARROW);
    // guard 在 `apply` 里注册（等 tools 激活）：先走一步装配。
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    const denied = await callTool(ctx, session, "web_fetch", "call-denied");
    const allowed = await callTool(ctx, session, "ask_user_question", "call-allowed");

    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("窄模式");
    expect(allowed.error).toBeUndefined();
  });

  it("再 apply 一次就是换一份：新的白名单生效，旧 guard 被收回", async () => {
    const { ctx, agent } = await mount();
    const session = await agent("switch");
    ctx.sessionToolScope.apply(session, WIDE);
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_search", "call-wide")).error).toBeUndefined();

    ctx.sessionToolScope.apply(session, NARROW);
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect(await visibleTools(ctx, session)).toEqual(["ask_user_question"]);
    expect((await callTool(ctx, session, "web_search", "call-narrow")).error).toBeDefined();

    // 换回宽的：只收新 guard 不收旧 guard 的话，这里会仍然被拒。
    ctx.sessionToolScope.apply(session, WIDE);
    await ctx.systemPrompt.assemble(assembleContextFor(session));
    expect((await callTool(ctx, session, "web_search", "call-back")).error).toBeUndefined();
  });
});

describe("instructions 与动态快照开关", () => {
  it("缺省为要：通道拿到 true，且拿到限制谓词", async () => {
    const { ctx, calls, agent } = await mount();
    const session = await agent("wide");
    ctx.sessionToolScope.apply(session, WIDE);
    await ctx.systemPrompt.assemble(assembleContextFor(session));

    expect(calls.filter((call) => call.kind === "instructions")).toEqual([
      { kind: "instructions", agent: session, value: true },
    ]);
    expect(calls.some((call) => call.kind === "restrict")).toBe(true);
  });

  it("instructions: false 时通道被关；runtimeContext: false 时只有这个会话看不到动态快照", async () => {
    const { ctx, calls, agent } = await mount();
    const silent = await agent("silent");
    const wide = await agent("wide");
    ctx.sessionToolScope.apply(silent, SILENT);
    ctx.sessionToolScope.apply(wide, WIDE);

    expect((await ctx.systemPrompt.assemble(assembleContextFor(silent))).contexts).toEqual([]);
    expect((await ctx.systemPrompt.assemble(assembleContextFor(wide))).contexts).toHaveLength(1);
    expect(calls.filter((call) => call.kind === "instructions" && call.value === false)).toEqual([
      { kind: "instructions", agent: silent, value: false },
    ]);
  });
});
