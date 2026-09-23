import { Context } from "@deepseek-ai/cordis";
import { assembleContextFor, installModelSelection, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {
  ModelSelectionProjection,
  ModelSelectionProjectionState,
} from "@deepseek-ai/dsh-api-session-controller";
import type { LlmCallConfig } from "@deepseek-ai/dsh-llm";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";
import { defineTool } from "@deepseek-ai/dsh-tools";
import * as scope from "@morlay/dsh-context-assembler/scope";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import * as plugin from "../index.ts";
import type { Config, SessionMode, SessionModeRole } from "../modes.ts";

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
      role: ["main"],
      persona: { prefix: "编码模式的提示词。", suffix: "最后一句。" },
      allowTools: ["read", "web_search"],
      instructions: true,
      runtimeContext: true,
    },
    chat: {
      name: "对话模式",
      description: "对话",
      role: ["main"],
      persona: { prefix: "对话模式的提示词。", suffix: "" },
      allowTools: ["web_search"],
      instructions: false,
      runtimeContext: false,
    },
  },
};

/** 只为本包用例服务的最小 `modelSelection` 投影：真实那份由上游 session-controller 注册。 */
function mountModelSelectionProjection(ctx: Context): void {
  ctx.sessionProjections.register({
    key: "modelSelection",
    // 与上游那份同样用 `unknown` 校验：这里只关心"有没有 pending"。
    stateSchema: z.unknown() as unknown as z.ZodType<ModelSelectionProjectionState>,
    stateVersion: 1,
    init: () => ({ lastUsed: null, pending: null }),
    apply: (state, event) =>
      event.type === "model/selection" ? { lastUsed: state.lastUsed, pending: event.data } : state,
    // `modelSelection` 在 session-controller 的 SessionProjectionMap 里是带 wire 的，注册必须同形。
    wire: {
      viewSchema: z.unknown() as unknown as z.ZodType<ModelSelectionProjection>,
      view: (state) => ({ lastUsed: state.lastUsed, next: state.pending ?? state.lastUsed }),
    },
  } satisfies ProjectionDefinition<"modelSelection", ModelSelectionProjectionState>);
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

/** 一个 config 想装载就必须被拒绝：装配期校验（`configProblem`）在构造函数里抛。 */
async function expectRefused(config: Config, reason: string): Promise<void> {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx);
  await mountAgentLoopTestHarness(ctx);

  await expect(ctx.plugin(plugin, config).then(() => ctx.fiber.await())).rejects.toThrow(reason);
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

/** 带角色与默认模型的 fixture：coding 配模型、chat 只给角色、reviewer 只给 subagent 角色。 */
const EXTENDED: Config = {
  default: "coding",
  // 默认模型的 home 是 config 的**顶层 volatile 字段**（不在模式定义里）：设置页编辑的就是这个路径。
  models: { coding: { provider: "ollama", model: "coding-model", reasoningEffort: "high" } },
  modes: {
    coding: {
      ...CONFIG.modes["coding"]!,
    },
    chat: { ...CONFIG.modes["chat"]!, role: ["main"] },
    reviewer: {
      name: "评审模式",
      description: "只读评审",
      role: ["subagent"],
      persona: { prefix: "评审模式的提示词。", suffix: "" },
      allowTools: ["read"],
      instructions: true,
      runtimeContext: true,
    },
  },
};

/** 请求路由的初值：谁都没配就是它，兜底生效时被换掉。 */
const SEED: LlmCallConfig = { provider: "global", model: "global-model" };

async function requestRoute(agent: Agent): Promise<LlmCallConfig> {
  return await agent.ctx.waterfall(
    "agent/request",
    { agent, turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve(SEED),
  );
}

describe("模式的角色与默认模型", () => {
  it("选择器只列 main 的角色，subagent 角色单独取", async () => {
    const { ctx } = await mount(EXTENDED);

    expect(ctx.sessionModes.idsFor("main")).toEqual(["coding", "chat"]);
    expect(ctx.sessionModes.idsFor("subagent")).toEqual(["reviewer"]);
    expect(ctx.sessionModes.roster().modes.map((mode) => mode.id)).toEqual(["coding", "chat"]);
    expect(ctx.sessionModes.modesFor("subagent").map((entry) => entry.mode.name)).toEqual([
      "评审模式",
    ]);
  });

  it("不是 main 角色的模式不能当会话模式选", async () => {
    const { ctx, agent } = await mount(EXTENDED);

    await expect(ctx.sessionModes.select(agent.id, "reviewer")).rejects.toThrow("不是用户可选的");
  });

  it("新会话用模式的默认模型（顶层 `models`）兜底请求路由", async () => {
    const { ctx, agent } = await mount(EXTENDED);

    const route = await requestRoute(agent);

    expect({
      provider: route.provider,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
    }).toEqual({ provider: "ollama", model: "coding-model", reasoningEffort: "high" });
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  it("没配默认模型的模式不插手请求路由", async () => {
    const { ctx, agent } = await mount(EXTENDED);
    await ctx.sessionModes.select(agent.id, "chat");

    expect(await requestRoute(agent)).toEqual(SEED);
  });

  it("会话落过请求头之后不再兜底（历史模型优先）", async () => {
    const { agent } = await mount(EXTENDED);
    agent.session.append("request/header", {
      header: { config: { provider: "global", model: "global-model" } },
      reason: "initial",
    });

    expect(await requestRoute(agent)).toEqual(SEED);
  });

  it("上游会话级选择在场时（无用户选择）模式兜底仍然生效", async () => {
    const { agent } = await mount(EXTENDED);
    // 上游 session-controller 的懒安装：没有 pending、没有 header 时它给全局默认。
    // 真实部署里这两个 listener 同时挂在 `agent/request` 上，谁最后写 route 就是这个用例的判据。
    installModelSelection(agent.ctx, {
      current: { provider: "global", model: "global-model" },
      assembled: undefined,
    });

    expect((await requestRoute(agent)).model).toBe("coding-model");
  });

  it("用户选过模型（投影 pending）时不覆盖", async () => {
    const { ctx, agent } = await mount(EXTENDED);
    mountModelSelectionProjection(ctx);
    agent.session.append("model/selection", { provider: "vendor", model: "vendor-model" });

    expect(await requestRoute(agent)).toEqual(SEED);
  });

  it("applyTo 是预留的指定接缝：按 id 应用并记账（不看空白会话）", async () => {
    const { ctx, agent } = await mount(EXTENDED);

    ctx.sessionModes.applyTo(agent, "reviewer");

    expect(ctx.sessionModes.modeOf(agent.session)).toBe("reviewer");
    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBe("reviewer");
    expect(sectionText(await assembled(ctx, agent), "deployment:persona-prefix")).toBe(
      "评审模式的提示词。",
    );
  });

  it("装配期校验：role 为空、default 不是 main 都拒绝装载", async () => {
    const cases: readonly (readonly [Record<string, SessionMode>, string])[] = [
      [
        { ...EXTENDED.modes, chat: { ...EXTENDED.modes["chat"]!, role: [] as SessionModeRole[] } },
        "role",
      ],
      [{ ...EXTENDED.modes, coding: { ...CONFIG.modes["coding"]!, role: ["subagent"] } }, "main"],
    ];
    for (const [modes, reason] of cases) {
      await expectRefused({ default: "coding", modes }, reason);
    }
  });

  it("装配期校验：`models` 的键写错、或 provider / model 缺一半都拒绝装载", async () => {
    await expectRefused(
      { default: "coding", modes: EXTENDED.modes, models: { absent: { provider: "ollama", model: "m" } } },
      "unknown mode(s) absent",
    );
    await expectRefused(
      {
        default: "coding",
        modes: EXTENDED.modes,
        models: { coding: { provider: "ollama", model: "" } },
      },
      "without both `provider` and `model`",
    );
  });
});

describe("各模式的默认模型是顶层 volatile 字段", () => {
  it("schema 上 `models` 是 volatile，`modes` 不是——设置面只挑得出前者", () => {
    // settings 的 describe 用 `volatileForm(schema)` 挑可编辑字段：volatile 节点本身、且路径必须固定。
    // dict 内部的字段一律 blocked，所以"某个模式的默认模型"只能挂在顶层（见 ADR）。
    expect(plugin.Config.dict?.["models"]?.meta.volatile).toBe(true);
    expect(plugin.Config.dict?.["modes"]?.meta.volatile).not.toBe(true);
  });

  it("解析之后它是个稳定引用：写进引用的新值立刻被下一次请求读到（这行不重挂）", async () => {
    const { ctx, agent } = await mount(EXTENDED);
    expect(await requestRoute(agent)).toMatchObject({
      provider: "ollama",
      model: "coding-model",
    });

    // 模拟 settings 的 volatile 提交：它写的就是这个引用（符号的 home 在 cosmokit 的 volatile.ts）。
    const write = Symbol.for("cosmokit.volatile.write");
    const ref = ctx.sessionModes.config.models as unknown as Record<
      symbol,
      (value: unknown) => void
    >;
    ref[write]!({ coding: { provider: "vendor", model: "vendor-model" } });

    expect(await requestRoute(agent)).toMatchObject({
      provider: "vendor",
      model: "vendor-model",
    });
  });
});

describe("子代理继承父模式", () => {
  it("继承父当前模式，并把继承写进子会话（恢复与 fork 能重建）", async () => {
    const { ctx, agent: parent } = await mount(EXTENDED);
    await ctx.sessionModes.select(parent.id, "chat");

    const child = await ctx.agents.create({
      sessionId: SessionId(`session-mode-child-${String(Date.now())}-${String(Math.random())}`),
      parentAgent: parent,
      meta: { parentSession: parent.id, origin: "subagent" },
    });

    expect(ctx.sessionProjections.stateOf(child.agent.session, "sessionMode")).toBe("chat");
    expect(ctx.sessionModes.modeOf(child.agent.session)).toBe("chat");
    expect(sectionText(await assembled(ctx, child.agent), "deployment:persona-prefix")).toBe(
      "对话模式的提示词。",
    );
  });

  it("父不在场时不继承，回落部署默认", async () => {
    const { ctx } = await mount(EXTENDED);

    const orphan = await ctx.agents.create({
      sessionId: SessionId(`session-mode-orphan-${String(Date.now())}-${String(Math.random())}`),
      meta: { parentSession: SessionId("no-such-parent"), origin: "subagent" },
    });

    expect(ctx.sessionModes.modeOf(orphan.agent.session)).toBe("coding");
  });
});
