import { Context } from "@deepseek-ai/cordis";
import { assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import * as scope from "@morlay/dsh-context-assembler/scope";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";
import type { Config } from "../modes.ts";

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

/** 归一化之后的形状（schema 填好了每个字段）——`apply` 收到的就是它。 */
const CONFIG: Config = {
  default: "coding",
  modes: {
    coding: {
      name: "编码模式",
      description: "编码",
      persona: { prefix: "编码模式的提示词。", suffix: "最后一句。" },
      allowTools: ["read", "web_search"],
      instructions: true,
      runtimeContext: true,
    },
    chat: {
      name: "对话模式",
      description: "对话",
      persona: { prefix: "对话模式的提示词。", suffix: "" },
      allowTools: ["web_search"],
      instructions: false,
      runtimeContext: false,
    },
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

/** host 平面装工具行（`dsh.profile.bundles` 列出 toolkit 的形状）与一条动态快照。 */
async function mountHostPlane(ctx: Context, toolNames: readonly string[]): Promise<void> {
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        for (const toolName of toolNames) inner.tools.register(fixtureTool(toolName));
        inner.systemPrompt.context({
          name: "sandbox:policy",
          order: 1,
          text: "Current DSH file policy: workspace-write.",
        });
      },
      { inject: ["tools", "systemPrompt"] },
    ),
  );
}

async function mount(config: Config = CONFIG) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
  });
  await mountAgentLoopTestHarness(ctx);
  await mountHostPlane(ctx, ["read", "web_search", "send_message"]);
  // 收口那一行（`context-assembler-scope`）：模式把它推给这个服务。
  await ctx.plugin(scope);
  await ctx.plugin(plugin, config);
  const handle = await ctx.agents.create({
    sessionId: SessionId(`session-mode-${String(Date.now())}-${String(Math.random())}`),
  });
  return { ctx, agent: handle.agent };
}

async function assembled(ctx: Context, agent: Agent) {
  return await ctx.systemPrompt.assemble(assembleContextFor(agent));
}

function sectionText(
  prompt: { sections: readonly { name: string; text: string }[] },
  name: string,
) {
  return prompt.sections.find((section) => section.name === name)?.text;
}

describe("会话模式的 persona", () => {
  it("默认模式：新会话读到的 persona 是该模式的，遮蔽部署级那层", async () => {
    const { ctx, agent } = await mount();
    const prompt = await assembled(ctx, agent);

    expect(sectionText(prompt, "deployment:persona-prefix")).toBe("编码模式的提示词。");
    expect(sectionText(prompt, "deployment:persona-suffix")).toBe("最后一句。");
  });

  it("切到 chat 之后：persona 换掉，工具收口与动态快照一起跟着换", async () => {
    const { ctx, agent } = await mount();
    expect((await assembled(ctx, agent)).tools.map((tool) => tool.name).toSorted()).toEqual([
      "read",
      "web_search",
    ]);

    await ctx.sessionModes.select(agent.id, "chat");
    const prompt = await assembled(ctx, agent);

    expect(sectionText(prompt, "deployment:persona-prefix")).toBe("对话模式的提示词。");
    // chat 没有 suffix：空串遮蔽掉部署级那层（与上游 persona 行同语义）。
    expect(sectionText(prompt, "deployment:persona-suffix")).toBe("");
    // 收口：只剩 chat 的那一件。
    expect(prompt.tools.map((tool) => tool.name)).toEqual(["web_search"]);
    // runtimeContext: false → 这个会话看不到动态快照。
    expect(prompt.contexts).toEqual([]);
    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBe("chat");
  });

  it("装配是幂等的：同一个模式反复装配不会重复注册", async () => {
    const { ctx, agent } = await mount();

    await assembled(ctx, agent);
    await assembled(ctx, agent);

    expect(sectionText(await assembled(ctx, agent), "deployment:persona-prefix")).toBe(
      "编码模式的提示词。",
    );
  });
});

describe("模式的读取与切换", () => {
  it("清单按 config 的插入序、默认模式来自 config", async () => {
    const { ctx } = await mount();

    expect(ctx.sessionModes.defaultId).toBe("coding");
    expect(ctx.sessionModes.roster()).toEqual({
      default: "coding",
      modes: [
        { id: "coding", name: "编码模式", description: "编码" },
        { id: "chat", name: "对话模式", description: "对话" },
      ],
    });
  });

  it("没选过模式的会话读投影拿到默认值", async () => {
    const { ctx, agent } = await mount();

    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBeNull();
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  it("已开始的会话拒绝切换（历史是在旧模式的工具与提示词下产生的）", async () => {
    const { ctx, agent } = await mount();
    agent.session.append("turn/start", { turn: 1 });

    await expect(ctx.sessionModes.select(agent.id, "chat")).rejects.toThrow("已经开始");
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  it("未知模式与未知会话都拒绝", async () => {
    const { ctx, agent } = await mount();

    await expect(ctx.sessionModes.select(agent.id, "nope")).rejects.toThrow("未知的模式");
    await expect(ctx.sessionModes.select(SessionId("no-such-session"), "chat")).rejects.toThrow(
      "未知的会话",
    );
  });

  it("装配期校验：默认模式不在清单里直接拒绝装载", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx);
    await mountAgentLoopTestHarness(ctx);

    await expect(
      ctx.plugin(plugin, { default: "absent", modes: CONFIG.modes }).then(() => ctx.fiber.await()),
    ).rejects.toThrow("default");
  });
});
