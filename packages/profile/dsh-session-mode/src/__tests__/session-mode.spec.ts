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
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { FsVersion, type FsWriteIntent } from "@deepseek-ai/dsh-fs";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it } from "vitest";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import { z } from "zod";
import * as plugin from "../index.ts";
import { sessionModeEditableProjection } from "../index.ts";
import type { Config, SessionMode, SessionModeRole } from "../modes.ts";

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

// 归一化之后的形状（schema 填好了每个字段）——`apply` 收到的就是它。
const CONFIG: Config = {
  default: "coding",
  modes: {
    coding: {
      preset: "standard",
      name: "编码模式",
      description: "编码",
      role: ["main"],
      persona: { prefix: "编码模式的提示词。", suffix: "最后一句。" },
      allowTools: ["read", "web_search"],
      denyTools: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: true,
      runtimeContext: true,
    },
    chat: {
      preset: "minimal",
      name: "对话模式",
      description: "对话",
      role: ["main"],
      persona: { prefix: "对话模式的提示词。", suffix: "" },
      allowTools: ["web_search"],
      denyTools: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: false,
      runtimeContext: false,
    },
  },
};

// 只为本包用例服务的最小 `modelSelection` 投影：真实那份由上游 session-controller 注册。
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

// host 平面装工具行（`dsh.profile.bundles` 列出 `tool-guidance` 的形状）与一条动态快照。
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
  // 按会话收口由本行内部持有（收口的输入就是模式定义），所以这里只装模式行。
  await ctx.plugin(plugin, config);
  const handle = await ctx.agents.create({
    sessionId: SessionId(`session-mode-${String(Date.now())}-${String(Math.random())}`),
  });
  return { ctx, agent: handle.agent };
}

// 官方 preset registry 的替身：只做 `select` 与 `composedPreset` 两件事——按请求换行清单、写
// `agent-preset/selected` 会话事件并按真 registry 的方式转发；返回它收到的 preset 序列（切了几次、切到哪）。
// `options.composedPreset` 是替身的"当前挂着哪个 preset"（真 registry 读 agent 的 scope 父链）。
function installFakeRegistry(ctx: Context, options: { composedPreset?: string } = {}): string[] {
  const picked: string[] = [];
  ctx.provide("agentPresets", {
    async select(agent: Agent, preset: string) {
      picked.push(preset);
      agent.session.append("agent-preset/selected", { agentPreset: preset });
      ctx.emit("agent-preset/selected", agent.id, preset);
      return preset;
    },
    composedPreset: () => options.composedPreset,
  } as unknown as Context["agentPresets"]);
  return picked;
}

// 一个 config 想装载就必须被拒绝：装配期校验（`configProblem`）在构造函数里抛。
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

  it("allowTools 留空：这个会话用宿主平面的全部工具（不设收窄）", async () => {
    const { ctx, agent } = await mount({
      default: CONFIG.default,
      modes: { ...CONFIG.modes, coding: { ...CONFIG.modes["coding"]!, allowTools: [] } },
    });

    // 宿主平面装了三件（`read` / `web_search` / `send_message`）：留空就是一件都不砍。
    expect((await assembled(ctx, agent)).tools.map((tool) => tool.name).toSorted()).toEqual([
      "read",
      "send_message",
      "web_search",
    ]);
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

  it("可改与否是**客户端可见**的投影：空白会话为可改，开过 turn 之后为不可改", async () => {
    const { ctx, agent } = await mount();

    expect(ctx.sessionProjections.stateOf(agent.session, "sessionModeEditable")).toBe(true);

    agent.session.append("turn/start", { turn: 1 });

    // 与服务端拒绝切换读同一份事实：client 的只读形态据此而定。
    expect(ctx.sessionProjections.stateOf(agent.session, "sessionModeEditable")).toBe(false);
    expect(sessionModeEditableProjection.wire?.view(false)).toBe(false);
  });

  it("未知模式与未知会话都拒绝", async () => {
    const { ctx, agent } = await mount();

    await expect(ctx.sessionModes.select(agent.id, "nope")).rejects.toThrow("未知的模式");
    await expect(ctx.sessionModes.select(SessionId("no-such-session"), "chat")).rejects.toThrow(
      "未知的会话",
    );
  });

  it("选模式时把官方 preset 一起切，且只写一条 session-mode/selected", async () => {
    const { ctx, agent } = await mount();
    const picked = installFakeRegistry(ctx);

    await ctx.sessionModes.select(agent.id, "chat");

    // preset 跟着模式走：行清单归官方 registry，模式只决定"用哪一份行 + 怎么收口"。
    expect(picked).toEqual(["minimal"]);
    // 官方那条路会 emit `agent-preset/selected`（监听里再落一次事实）：同一个值不写第二条。
    const selected = agent.session
      .ownEvents()
      .filter((event) => event.type === "session-mode/selected");
    expect(selected.map((event) => event.data.sessionMode)).toEqual(["chat"]);
    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBe("chat");
  });

  it("模式没声明 preset（空串）时不碰官方 registry", async () => {
    const { ctx, agent } = await mount({
      default: CONFIG.default,
      modes: { ...CONFIG.modes, chat: { ...CONFIG.modes["chat"]!, preset: "" } },
    });
    const picked = installFakeRegistry(ctx);

    await ctx.sessionModes.select(agent.id, "chat");

    expect(picked).toEqual([]);
    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBe("chat");
  });

  it("registry 没装（headless）时只落我们的会话事实", async () => {
    const { ctx, agent } = await mount();

    await ctx.sessionModes.select(agent.id, "chat");

    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBe("chat");
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

// 机制：两个模式可以共享**同一份** preset 声明（差异全在会话级收口：persona / 名单 / 三个开关）。preset 是
// 行清单的 home，模式是它的会话级扩展；本部署两个模式都不声明它，这条路径留给"声明了才换"的部署形态。
const SHARED: Config = {
  default: "coding",
  modes: {
    coding: { ...CONFIG.modes["coding"]!, preset: "mode-switch" },
    chat: { ...CONFIG.modes["chat"]!, preset: "mode-switch" },
  },
};

describe("两个模式共享一份 preset", () => {
  it("共享是合法的：装配期校验不再要求 preset 一对一", async () => {
    const { ctx } = await mount(SHARED);

    expect(ctx.sessionModes.defaultId).toBe("coding");
    expect(ctx.sessionModes.roster().modes.map((mode) => mode.id)).toEqual(["coding", "chat"]);
    expect(SHARED.modes["coding"]?.preset).toBe(SHARED.modes["chat"]?.preset);
  });

  it("共享时 preset → 模式的反查不回答；一对一映射照旧回答", async () => {
    const { ctx } = await mount(SHARED);
    expect(ctx.sessionModes.modeForPreset("mode-switch")).toBeUndefined();
    expect(ctx.sessionModes.modeForPreset(undefined)).toBeUndefined();

    const unique = await mount(CONFIG);
    expect(unique.ctx.sessionModes.modeForPreset("minimal")).toBe("chat");
    expect(unique.ctx.sessionModes.modeForPreset("nope")).toBeUndefined();
  });

  it("目标 preset 已经挂着就不换：切模式只换会话收口（不重挂行清单）", async () => {
    const { ctx, agent } = await mount(SHARED);
    const picked = installFakeRegistry(ctx, { composedPreset: "mode-switch" });

    await ctx.sessionModes.select(agent.id, "chat");

    // 一次 recompose 都没发生，但模式事实照落、persona 与收口换成 chat 那一份。
    expect(picked).toEqual([]);
    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBe("chat");
    expect(sectionText(await assembled(ctx, agent), "deployment:persona-prefix")).toBe(
      "对话模式的提示词。",
    );
  });

  it("同一个模式重复选是幂等的：事实不重复写、preset 不重挂", async () => {
    const { ctx, agent } = await mount(SHARED);
    const picked = installFakeRegistry(ctx, { composedPreset: "mode-switch" });

    await ctx.sessionModes.select(agent.id, "coding");
    await ctx.sessionModes.select(agent.id, "coding");

    expect(picked).toEqual([]);
    // 第一次把"这个会话是 coding"落成事实（投影原本是空的），第二次同一个值不写第二条。
    expect(
      agent.session
        .ownEvents()
        .filter((event) => event.type === "session-mode/selected")
        .map((event) => event.data.sessionMode),
    ).toEqual(["coding"]);
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  it("挂在别的 preset 上时照旧切过去（模式声明的 preset 与当前不同）", async () => {
    const { ctx, agent } = await mount(SHARED);
    const picked = installFakeRegistry(ctx, { composedPreset: "standard" });

    await ctx.sessionModes.select(agent.id, "chat");

    expect(picked).toEqual(["mode-switch"]);
    expect(ctx.sessionProjections.stateOf(agent.session, "sessionMode")).toBe("chat");
  });

  it("registry 没有 `composedPreset` 读面时按未知处理：该切就切", async () => {
    const { ctx, agent } = await mount(SHARED);
    const picked = installFakeRegistry(ctx);

    await ctx.sessionModes.select(agent.id, "chat");

    expect(picked).toEqual(["mode-switch"]);
  });
});

// 带角色与默认模型的 fixture：coding 自带模型、chat 只给角色、reviewer 只给 subagent 角色。
const EXTENDED: Config = {
  default: "coding",
  modes: {
    coding: {
      ...CONFIG.modes["coding"]!,
      // 默认模型的 home 是**模式自己**：装配层写在这里，设置页编辑的也是这个路径。
      defaultModel: { provider: "ollama", model: "coding-model", reasoningEffort: "high" },
    },
    chat: { ...CONFIG.modes["chat"]!, role: ["main"] },
    reviewer: {
      preset: "",
      name: "评审模式",
      description: "只读评审",
      role: ["subagent"],
      persona: { prefix: "评审模式的提示词。", suffix: "" },
      allowTools: ["read"],
      denyTools: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: true,
      runtimeContext: true,
    },
  },
};

// 请求路由的初值：谁都没配就是它，兜底生效时被换掉。
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

  it("新会话用模式自己的默认模型兜底请求路由", async () => {
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

  it("装配期校验：`defaultModel` 的 provider / model 缺一半就拒绝装载", async () => {
    await expectRefused(
      {
        default: "coding",
        modes: {
          ...EXTENDED.modes,
          coding: { ...EXTENDED.modes["coding"]!, defaultModel: { provider: "ollama", model: "" } },
        },
      },
      "without both `provider` and `model`",
    );
  });

  it("装配期校验：退役的顶层 `models` 还配着值就拒绝装载（提醒挪进模式）", async () => {
    await expectRefused(
      {
        default: "coding",
        modes: EXTENDED.modes,
        models: { coding: { provider: "ollama", model: "m" } },
      },
      "has moved into each mode's `defaultModel`",
    );
  });
});

describe("默认模型住在模式定义里", () => {
  it("模式清单与默认模式是 volatile，默认模型跟着模式一起上页面", () => {
    expect(plugin.Config.dict?.["default"]?.meta.volatile).toBe(true);
    expect(plugin.Config.dict?.["modes"]?.meta.volatile).toBe(true);
    // 顶层不再有那份映射；`defaultModel` 不单独标 volatile（外层 modes 已经是）。
    expect(plugin.Config.dict?.["models"]?.meta.volatile).not.toBe(true);
    expect(volatileForm(plugin.Config as never)).toBeDefined();
  });
});

// 按模式的 policy 拦截的 fixture：只换 `coding` 的两份 policy 名单（`chat` 一条都不配，用作成对判据）。
function withPolicies(policies: Pick<SessionMode, "allowPolicies" | "denyPolicies">): Config {
  return {
    default: CONFIG.default,
    modes: {
      coding: { ...CONFIG.modes["coding"]!, ...policies },
      chat: { ...CONFIG.modes["chat"]! },
    },
  };
}

// `fs-observation-policy` 的同形替身：在这两条 waterfall 上**独占决策槽**——它不调 `next()`，写给一个写意图、
// 改在"没观察过"时抛 `FS_NOT_OBSERVED`（上游就是用 throw 表达这条拒绝）。它把自己被问过几次记下来。
function installPolicyStub(ctx: Context): { asked: string[] } {
  const asked: string[] = [];
  ctx.on("fs/write-intent", () => {
    asked.push("write");
    return Promise.resolve<FsWriteIntent>({ kind: "replaceIfVersion", version: FsVersion("v1") });
  });
  ctx.on("fs/edit-intent", () => {
    asked.push("edit");
    throw new Error("FS_NOT_OBSERVED");
  });
  return { asked };
}

// 一次真的 waterfall 调用：`actor` 用工具那副形状——工具把自己的 exec 传进来（这里只关心它上面挂着的 `agent`）。
async function editIntent(ctx: Context, actor: object): Promise<unknown> {
  return await ctx.waterfall("fs/edit-intent", {} as never, actor, () => undefined);
}

async function writeIntent(ctx: Context, actor: object): Promise<unknown> {
  return await ctx.waterfall("fs/write-intent", {} as never, actor, () => undefined);
}

const UPSTREAM_WRITE_INTENT = { kind: "replaceIfVersion", version: "v1" };

describe("按模式的 policy 拦截", () => {
  // 本部署那条配置的形状：`coding` 禁 `fs/edit-intent`（免"先读后改"），写路径上的 CAS 安全网留着。
  const CODING_EDITS_FREE = withPolicies({ allowPolicies: [], denyPolicies: ["fs/edit-intent"] });

  it("被禁的规则：上游的拒绝被绕过（这次调用按没有这条规则继续）", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    const stub = installPolicyStub(ctx);

    // 上游那句 `FS_NOT_OBSERVED` 被接住，调用拿到 `undefined`（= 无版本前提的编辑）。
    await expect(editIntent(ctx, { agent })).resolves.toBeUndefined();
    // 上游还是被问了：先让它算完，再丢掉结论。
    expect(stub.asked).toEqual(["edit"]);
  });

  it("只禁一条时另一条照旧：写路径上的上游裁决原样出去", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);

    await expect(writeIntent(ctx, { agent })).resolves.toEqual(UPSTREAM_WRITE_INTENT);
  });

  it("没配 policy 名单的模式照旧吃上游的拒绝（成对判据）", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);
    await ctx.sessionModes.select(agent.id, "chat");

    await expect(editIntent(ctx, { agent })).rejects.toThrow("FS_NOT_OBSERVED");
  });

  it("只给某个模式配：同一个 ctx 上另一个模式的会话不受影响", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);
    const other = await ctx.agents.create({
      sessionId: SessionId(`session-mode-chat-${String(Date.now())}-${String(Math.random())}`),
    });
    await ctx.sessionModes.select(other.agent.id, "chat");

    // 一份监听器、一个判据函数：结论按各自的会话现算。
    await expect(editIntent(ctx, { agent })).resolves.toBeUndefined();
    await expect(editIntent(ctx, { agent: other.agent })).rejects.toThrow("FS_NOT_OBSERVED");
  });

  it("模式切换后换一份判定（判据每次调用现算，监听器不换）", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    const stub = installPolicyStub(ctx);

    await expect(editIntent(ctx, { agent })).resolves.toBeUndefined();

    await ctx.sessionModes.select(agent.id, "chat");

    await expect(editIntent(ctx, { agent })).rejects.toThrow("FS_NOT_OBSERVED");
    expect(stub.asked).toEqual(["edit", "edit"]);
  });

  it("认不出 agent 的调用照旧问上游（判据只认 `actor.agent`）", async () => {
    const { ctx } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);

    await expect(editIntent(ctx, {})).rejects.toThrow("FS_NOT_OBSERVED");
  });

  it("重复应用同一个模式：一次监听器注册都不发生", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);
    // 数装配期的注册：那两条监听器是构造时注册的，`applyTo` / `select` / 子代理继承都不该再加一份。
    const registrations: string[] = [];
    const on = ctx.on.bind(ctx) as (name: string, ...rest: unknown[]) => unknown;
    ctx.on = ((name: string, ...rest: unknown[]) => {
      if (name.startsWith("fs/")) registrations.push(name);
      return on(name, ...rest);
    }) as typeof ctx.on;

    ctx.sessionModes.applyTo(agent, "chat");
    ctx.sessionModes.applyTo(agent, "coding");
    ctx.sessionModes.applyTo(agent, "coding");
    await ctx.sessionModes.select(agent.id, "coding");

    expect(registrations).toEqual([]);
    // 拦截照旧按现算的判据生效（重复应用没有把它变成两份判断）。
    await expect(editIntent(ctx, { agent })).resolves.toBeUndefined();
  });

  it("生效集合 =（白名单留空 ? 全部 : 白名单）− 黑名单：deny 优先", async () => {
    // 白名单只留写规则：改规则不在生效集合里，照样被绕过。
    const onlyWrite = await mount(
      withPolicies({ allowPolicies: ["fs/write-intent"], denyPolicies: [] }),
    );
    installPolicyStub(onlyWrite.ctx);
    await expect(editIntent(onlyWrite.ctx, { agent: onlyWrite.agent })).resolves.toBeUndefined();
    await expect(writeIntent(onlyWrite.ctx, { agent: onlyWrite.agent })).resolves.toEqual(
      UPSTREAM_WRITE_INTENT,
    );

    // 两份名单同时命中同一条：deny 优先（这条规则被绕过）。
    const both = await mount(
      withPolicies({ allowPolicies: ["fs/edit-intent"], denyPolicies: ["fs/edit-intent"] }),
    );
    installPolicyStub(both.ctx);
    await expect(editIntent(both.ctx, { agent: both.agent })).resolves.toBeUndefined();
  });

  it("装配期校验：policy 名字不在已知名单里就拒绝装载", async () => {
    for (const policies of [
      { allowPolicies: ["fs/read-intent"], denyPolicies: [] },
      { allowPolicies: [], denyPolicies: ["fs/read-intent"] },
    ]) {
      await expectRefused(withPolicies(policies), "unknown policies");
    }
  });
});

// 一次真的工具调用：执行层守卫挂在 `agent` 的 scope 上（被拒时错误里带模式名与拒因）。
async function executeTool(ctx: Context, agent: Agent, name: string) {
  return await ctx.tools.execute({
    callId: ToolCallId(`call-${name}-${String(Math.random())}`),
    name,
    arguments: {},
    agent,
    signal: new AbortController().signal,
  });
}

describe("模式与收口（工具名单）", () => {
  it("换模式就是换一份收口：各自的名单（白名单 − 黑名单）生效", async () => {
    const { ctx, agent } = await mount({
      default: CONFIG.default,
      modes: {
        coding: { ...CONFIG.modes["coding"]!, denyTools: ["web_search"] },
        chat: { ...CONFIG.modes["chat"]! },
      },
    });
    await assembled(ctx, agent);

    // 收口要的几项按模式定义整份推过去：`chat` 的白名单只剩 web_search。
    ctx.sessionModes.applyTo(agent, "chat");
    expect((await assembled(ctx, agent)).tools.map((tool) => tool.name)).toEqual(["web_search"]);

    // 换到 `coding`：白名单是 read / web_search，黑名单减掉 web_search（同一份里 deny 优先）。
    ctx.sessionModes.applyTo(agent, "coding");
    expect((await assembled(ctx, agent)).tools.map((tool) => tool.name)).toEqual(["read"]);
  });

  it("`denyTools` 的收窄：黑名单里的工具进不了目录、调用被拒（文案说黑名单）", async () => {
    const { ctx, agent } = await mount({
      default: CONFIG.default,
      modes: {
        // 白名单留着 read / web_search，另外把 web_search 禁掉：同一份里 deny 优先。
        coding: { ...CONFIG.modes["coding"]!, denyTools: ["web_search"] },
        chat: { ...CONFIG.modes["chat"]! },
      },
    });
    await assembled(ctx, agent);

    // 目录：白名单那两件减掉黑名单那一件。
    expect((await assembled(ctx, agent)).tools.map((tool) => tool.name)).toEqual(["read"]);

    const denied = await executeTool(ctx, agent, "web_search");
    // 成对判据：留下的那件照旧能调，被拒那件说的是黑名单（与"不在白名单里"分开）。
    expect((await executeTool(ctx, agent, "read")).error).toBeUndefined();
    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("黑名单");
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
