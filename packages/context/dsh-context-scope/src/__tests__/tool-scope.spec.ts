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
