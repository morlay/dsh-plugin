import { Context } from "@deepseek-ai/cordis";
import { assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import { SessionId } from "@deepseek-ai/dsh-session";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

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

/** 在某个 scope 上装工具行，形状与 preset / host 层的装配一致。 */
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

async function mount(allowTools: readonly string[]) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
  });
  await mountAgentLoopTestHarness(ctx);

  const key = { preset: "chat" };
  const standing = createScope(ctx, key);
  await mountTools(standing.ctx, ["ask_user_question", "web_search", "web_fetch"]);
  await standing.ctx.plugin(plugin, { allowTools: [...allowTools] });

  // scope 父链必须在 create 期间绑好：`agent/created` 就在那时派发，晚了就判定不到归属。
  const handle = await ctx.agents.create({
    sessionId: SessionId(`tool-scope-${Date.now()}-${Math.random()}`),
    setup: async (agentCtx: Context) => {
      bindScopeParent(scopeOf(agentCtx)!, key);
    },
  });
  return { ctx, agent: handle.agent };
}

async function visibleTools(ctx: Context, agent: Agent): Promise<string[]> {
  return (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(
    (tool) => tool.name,
  );
}

describe("工具白名单", () => {
  it("只留白名单里的工具，host 层多出来的进不了目录", async () => {
    const { ctx, agent } = await mount(["ask_user_question", "web_search", "web_fetch"]);
    // 模拟 bundle 开关在 host 层插进来的 team 工具。
    await mountTools(ctx, ["send_message", "list_agents"]);

    expect((await visibleTools(ctx, agent)).toSorted()).toEqual([
      "ask_user_question",
      "web_fetch",
      "web_search",
    ]);
  });

  it("白名单之外的工具调用不了", async () => {
    const { ctx, agent } = await mount(["ask_user_question"]);
    await mountTools(ctx, ["send_message"]);
    // guard 在装配期注册：先走一步装配。
    await ctx.systemPrompt.assemble(assembleContextFor(agent));

    const denied = await ctx.tools.execute({
      callId: ToolCallId("call-send"),
      name: "send_message",
      arguments: {},
      agent,
      signal: new AbortController().signal,
    });
    const allowed = await ctx.tools.execute({
      callId: ToolCallId("call-ask"),
      name: "ask_user_question",
      arguments: {},
      agent,
      signal: new AbortController().signal,
    });

    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("不在本模式的工具范围内");
    expect(allowed.error).toBeUndefined();
  });

  it("空 allow 直接装配失败：该省掉整行，而不是挂个空作用域", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {});
    await mountAgentLoopTestHarness(ctx);

    await expect(ctx.plugin(plugin, { allowTools: [] })).rejects.toThrow(/allow/u);
  });
});

describe("runtime context 开关", () => {
  /** 上游 `sandbox-policy` / `user-approval` 的形状：host 层注册一条动态快照。 */
  async function mountSnapshot(ctx: Context, text: string): Promise<void> {
    await ctx.plugin(
      Object.assign(
        (inner: Context) => {
          inner.systemPrompt.context({ name: "sandbox:policy", order: 1, text });
        },
        { inject: ["systemPrompt"] },
      ),
    );
  }

  async function agentIn(ctx: Context, preset: string, config: Record<string, unknown>) {
    const key = { preset };
    const standing = createScope(ctx, key);
    await mountTools(standing.ctx, ["ask_user_question", "web_search", "web_fetch"]);
    await standing.ctx.plugin(plugin, { allowTools: ["ask_user_question"], ...config });
    const handle = await ctx.agents.create({
      sessionId: SessionId(`runtime-context-${preset}-${Date.now()}-${Math.random()}`),
      setup: async (agentCtx: Context) => {
        bindScopeParent(scopeOf(agentCtx)!, key);
      },
    });
    return handle.agent;
  }

  async function contextNames(ctx: Context, agent: Agent): Promise<string[]> {
    return (await ctx.systemPrompt.assemble(assembleContextFor(agent))).contexts.map(
      (entry) => entry.name,
    );
  }

  it("关掉时只挡本 scope 的动态快照，别的 scope 照旧收到", async () => {
    // 抑制必须按 scope：它清的是装配结果里的**全部**动态 context（沙箱策略、审批策略都在其中），
    // 一旦变成全局动作，官方 preset 与 coding 也一起失明。
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个助手。" },
    });
    await mountAgentLoopTestHarness(ctx);
    await mountSnapshot(ctx, "Current DSH file policy: workspace-write.");

    const silenced = await agentIn(ctx, "chat", { runtimeContext: false });
    const kept = await agentIn(ctx, "coding", {});

    expect(await contextNames(ctx, silenced)).toEqual([]);
    expect(await contextNames(ctx, kept)).toEqual(["sandbox:policy"]);
  });

  it("缺省要 runtime context：模式不声明就是照收", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {});
    await mountAgentLoopTestHarness(ctx);
    await mountSnapshot(ctx, "Approval policy: ask.");

    expect(await contextNames(ctx, await agentIn(ctx, "coding", {}))).toEqual(["sandbox:policy"]);
  });
});
