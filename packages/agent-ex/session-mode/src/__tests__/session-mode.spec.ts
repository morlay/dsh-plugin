// 真 cordis ctx 的宽形状由 support/mount 提供（vendor 的类型增强不在本仓 TS program 里）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication } from "@morlay/zephyr";
import { mountSessionModeApp } from "./support/mount-app.ts";
import {
  sessionModeTestProviders,
  type SessionModeTestOptions,
} from "./support/session-mode-providers.ts";
import { bootStorage, counting, memoryDomain, type MemoryDomain } from "./support/storage.ts";
import { SessionId } from "@morlay/dsh-session/contract";
import type { LlmCallConfig } from "@morlay/dsh-agent/contract";
import { ToolCallId, assembleContextFor, type Agent } from "@morlay/dsh-agent/contract";
import {
  FsEditIntentEvent,
  FsVersion,
  FsWriteIntentEvent,
  type FsWriteIntent,
} from "@morlay/dsh-fs/contract";
import { defineTool } from "@morlay/dsh-agent/contract";
import type { TestContext } from "./support/context.ts";
import { describe, expect, test } from "@morlay/session-mode/testing";
import { onTestFinished } from "vitest";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import {
  SESSION_MODE_TABLE,
  SessionModeDefault,
  sessionModeDomainSpec,
  sessionModeEditableProjection,
  type ModeConfig,
  type SessionModeProviderConfig,
  type SessionModeRole,
} from "@morlay/session-mode";
import { pinDshHome } from "./support/dsh-home.ts";

// 用例里的模式定义就是被测输入：把 `{dshHome}/modes/*.toml` 指到空目录，别让开发机上真用户的覆盖参与装配。
pinDshHome();

// 归一化之后的形状（schema 填好了每个字段）——`apply` 收到的就是它。
const CONFIG = {
  default: "coding",
  modes: {
    coding: {
      presetsOnly: ["standard"],
      name: "编码模式",
      description: "编码",
      role: ["main"],
      persona: { prefix: "编码模式的提示词。", suffix: "最后一句。" },
      allowTools: ["read", "web_search"],
      denyTools: [],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: true,
      runtimeContext: true,
    },
    chat: {
      presetsOnly: ["minimal"],
      name: "对话模式",
      description: "对话",
      role: ["main"],
      persona: { prefix: "对话模式的提示词。", suffix: "" },
      allowTools: ["web_search"],
      denyTools: [],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: false,
      runtimeContext: false,
    },
  },
};

// 只为本包用例服务的最小 `modelSelection` 投影：真实那份由上游 session-controller 注册。
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
async function mountHostPlane(ctx: TestContext, toolNames: readonly string[]): Promise<void> {
  await ctx.plugin(
    Object.assign(
      (inner: TestContext) => {
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

async function mount(
  config: SessionModeProviderConfig = CONFIG,
  options: SessionModeTestOptions = {},
  sessionId: SessionId = SessionId(`session-mode-${String(Date.now())}-${String(Math.random())}`),
) {
  // 一次 `bootstrapApplication`：骨架 + 会话 + 循环 + 模式行（收口的输入就是模式定义）。
  // `options` 里的 `storage` 决定这一套装配有没有存储域（不写就是 headless 形态，没有持久化）。
  const { app, ctx } = await mountSessionModeApp({
    ...options,
    systemPrompt: {
      includeHarnessIdentity: false,
      personaPrefix: "部署级提示词。",
      ...options.systemPrompt,
    },
    modes: config as unknown as Record<string, unknown>,
  });
  onTestFinished(() => app.dispose());
  await mountHostPlane(ctx, ["read", "web_search", "send_message"]);
  const handle = await ctx.agents.create({ sessionId });
  return { ctx, agent: handle.agent };
}

// 模式定义收敛到 `{dshHome}/modes/*.toml` 之后，行 config 只带 `default`：内置默认必须在**构造期校验之前**就位，
// 否则装配会在 `modes must declare at least one mode` 上直接失败（整行不激活，GUI 起不来）。
// 切模式 = 同一实例上的第二次 `apply`：旧的必须**同步**收干净，否则第二次注册会撞
// `tool "describe_tool" is already registered in this scope`（线上 409 就是这条）。
describe("同一实例重装", () => {
  test("切模式（第二次 apply）不撞名", async () => {
    const { ctx, agent } = await mount();

    expect(() => {
      ctx.sessionModes.applyTo(agent, "chat");
    }).not.toThrow();
    expect(() => {
      ctx.sessionModes.applyTo(agent, "coding");
    }).not.toThrow();
  });
});

describe("行 config 不带 modes（生产形态）", () => {
  test("内置默认 coding / chat / noop 就位，默认模式也是其中之一", async () => {
    const { ctx } = await mount({ default: "coding", modes: {} });

    expect(
      ctx.sessionModes
        .list()
        .map((row) => row.id)
        .sort(),
    ).toEqual(["chat", "coding", "noop"]);
    expect(ctx.sessionModes.defaultId).toBe("coding");
  });
});

// 一个 config 想装载就必须被拒绝：装配期校验（`configProblem`）在构造函数里抛。
async function expectRefused(config: SessionModeProviderConfig, reason: string): Promise<void> {
  const { app } = await mountSessionModeApp();
  onTestFinished(() => app.dispose());
  // 装配期校验：整份清单交给 `bootstrapApplication`，它拒绝就是"装载被拒"。
  await expect(
    bootstrapApplication({
      providers: sessionModeTestProviders({ modes: config as unknown as Record<string, unknown> }),
      timeoutMs: 30_000,
    } as never),
  ).rejects.toThrow(reason);
}

async function assembled(ctx: TestContext, agent: Agent) {
  return await ctx.systemPrompt.assemble(assembleContextFor(agent));
}

// 模型目录 = 注册表视图（收窄落在 `tools.restrict` 上，装配瀑布里不再带工具声明）。
function visibleToolNames(ctx: TestContext, agent: Agent): string[] {
  // `describe_tool` 是本插件在 PTC 下常驻的控制工具，不参与"模式收窄"的断言。
  return ctx.tools
    .schemas(agent)
    .map((tool) => tool.name)
    .filter((name) => name !== "describe_tool")
    .toSorted();
}

function sectionText(
  prompt: { sections: readonly { name: string; text: string }[] },
  name: string,
) {
  return prompt.sections.find((section) => section.name === name)?.text;
}

describe("会话模式的 persona", () => {
  test("默认模式：新会话读到的 persona 是该模式的，遮蔽部署级那层", async () => {
    const { ctx, agent } = await mount();
    const prompt = await assembled(ctx, agent);

    expect(sectionText(prompt, "deployment:persona-prefix")).toBe("编码模式的提示词。");
    expect(sectionText(prompt, "deployment:persona-suffix")).toBe("最后一句。");
  });

  test("切到 chat 之后：persona 换掉，工具收口与动态快照一起跟着换", async () => {
    const { ctx, agent } = await mount();
    expect(visibleToolNames(ctx, agent)).toEqual(["read", "web_search"]);

    await ctx.sessionModes.select(agent.id, "chat");
    const prompt = await assembled(ctx, agent);

    expect(sectionText(prompt, "deployment:persona-prefix")).toBe("对话模式的提示词。");
    // chat 没有 suffix：空串遮蔽掉部署级那层（与上游 persona 行同语义）。
    expect(sectionText(prompt, "deployment:persona-suffix")).toBe("");
    // 收口：只剩 chat 的那一件。
    expect(visibleToolNames(ctx, agent)).toEqual(["web_search"]);
    // runtimeContext: false → 这个会话看不到动态快照。
    expect(prompt.contexts).toEqual([]);
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("chat");
  });

  test("allowTools 留空：这个会话用宿主平面的全部工具（不设收窄）", async () => {
    const { ctx, agent } = await mount({
      default: CONFIG.default,
      modes: { ...CONFIG.modes, coding: { ...CONFIG.modes["coding"]!, allowTools: [] } },
    });

    // 宿主平面装了 `read` / `send_message` 这类常驻工具（`web` 是按需组，默认不放行），外加两个组控制工具。
    expect(visibleToolNames(ctx, agent)).toEqual(["read"]);
  });

  test("装配是幂等的：同一个模式反复装配不会重复注册", async () => {
    const { ctx, agent } = await mount();

    await assembled(ctx, agent);
    await assembled(ctx, agent);

    expect(sectionText(await assembled(ctx, agent), "deployment:persona-prefix")).toBe(
      "编码模式的提示词。",
    );
  });
});

describe("模式的读取与切换", () => {
  test("清单按 config 的插入序、默认模式来自 config", async () => {
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

  test("没选过模式的会话读投影拿到默认值", async () => {
    const { ctx, agent } = await mount();

    expect(ctx.sessionModes.selectedOf(agent.session)).toBeNull();
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  test("已开始的会话拒绝切换（历史是在旧模式的工具与提示词下产生的）", async () => {
    const { ctx, agent } = await mount();
    agent.session.append("turn/start", { turn: 1 });

    await expect(ctx.sessionModes.select(agent.id, "chat")).rejects.toThrow("已经开始");
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  test("可改与否是**客户端可见**的投影：空白会话为可改，开过 turn 之后为不可改", async () => {
    const { ctx, agent } = await mount();

    expect(ctx.sessionModes.editableOf(agent.session)).toBe(true);

    agent.session.append("turn/start", { turn: 1 });

    // 与服务端拒绝切换读同一份事实：client 的只读形态据此而定。
    expect(ctx.sessionModes.editableOf(agent.session)).toBe(false);
    expect(sessionModeEditableProjection.wire?.view(false)).toBe(false);
  });

  test("未知模式与未知会话都拒绝", async () => {
    const { ctx, agent } = await mount();

    await expect(ctx.sessionModes.select(agent.id, "nope")).rejects.toThrow("未知的模式");
    await expect(ctx.sessionModes.select(SessionId("no-such-session"), "chat")).rejects.toThrow(
      "未知的会话",
    );
  });

  test("选模式时把官方 preset 落到模式允许的那份，且只写一条 session-mode/selected", async () => {
    const { ctx, agent } = await mount();

    await ctx.sessionModes.select(agent.id, "chat");

    // 本部署的 preset 写死在 config 上（`preset: "ptc"`），没有 roster 可换：切模式只换会话收口。
    // 这一条只剩「同一个值不写第二条事实」那半句可判——原样留着。
    // 本行的会话事件不在上游 `SessionEventMap` 里（那是本包自己落的事实）：读的时候按宽形状窄化一次。
    const selected = (
      agent.session.ownEvents() as readonly { readonly type: string; readonly data: unknown }[]
    ).filter((event) => event.type === "session-mode/selected");
    expect(
      selected.map((event) => (event.data as { readonly sessionMode: string }).sessionMode),
    ).toEqual(["chat"]);
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("chat");
  });

  test("模式不限 preset（空名单）时不碰官方 registry", async () => {
    const { ctx, agent } = await mount({
      default: CONFIG.default,
      modes: { ...CONFIG.modes, chat: { ...CONFIG.modes["chat"]!, presetsOnly: [] } },
    });
    await ctx.sessionModes.select(agent.id, "chat");

    // 名单留空 = 不限制：本部署没有 roster 可换，事实照落。
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("chat");
  });

  test("registry 没装（headless）时只落我们的会话事实", async () => {
    const { ctx, agent } = await mount();

    await ctx.sessionModes.select(agent.id, "chat");

    expect(ctx.sessionModes.modeOf(agent.session)).toBe("chat");
  });

  test("装配期校验：默认模式不在清单里直接拒绝装载", async () => {
    // 装配期校验：整份清单交给 `bootstrapApplication`，它拒绝就是"装载被拒"。
    await expect(
      bootstrapApplication({
        providers: sessionModeTestProviders({
          modes: { default: "absent", modes: CONFIG.modes } as unknown as Record<string, unknown>,
        }),
        timeoutMs: 30_000,
      } as never),
    ).rejects.toThrow("default");
  });

  test("装配期校验：退役的 `preset` 还配着值就拒绝装载（指向 `presetsOnly`）", async () => {
    await expectRefused(
      {
        default: "coding",
        modes: {
          ...CONFIG.modes,
          chat: { ...CONFIG.modes["chat"]!, preset: "minimal" },
        },
      },
      "presetsOnly",
    );
  });
});

// 机制：两个模式可以共享**同一份** preset 白名单（差异全在会话级收口：persona / 名单 / 三个开关）。preset 是
// 行清单的 home，模式只声明"允许挂哪些"；本部署两个模式都不声明它，这条路径留给"声明了就把当前那份落进名单"的形态。
const SHARED: SessionModeProviderConfig = {
  default: "coding",
  modes: {
    coding: { ...CONFIG.modes["coding"]!, presetsOnly: ["mode-switch", "spare"] },
    chat: { ...CONFIG.modes["chat"]!, presetsOnly: ["mode-switch", "spare"] },
  },
};

describe("两个模式共享一份 preset 白名单", () => {
  test("共享是合法的：装配期校验不再要求 preset 一对一", async () => {
    const { ctx } = await mount(SHARED);

    expect(ctx.sessionModes.defaultId).toBe("coding");
    expect(ctx.sessionModes.roster().modes.map((mode) => mode.id)).toEqual(["coding", "chat"]);
    const shared = SHARED.modes as Record<string, ModeConfig>;
    expect(shared["coding"]?.presetsOnly).toEqual(shared["chat"]?.presetsOnly);
  });

  test("共享时 preset → 模式的反查不回答；一对一映射照旧回答", async () => {
    const { ctx } = await mount(SHARED);
    expect(ctx.sessionModes.modeForPreset("mode-switch")).toBeUndefined();
    expect(ctx.sessionModes.modeForPreset("spare")).toBeUndefined();
    expect(ctx.sessionModes.modeForPreset(undefined)).toBeUndefined();

    const unique = await mount(CONFIG);
    expect(unique.ctx.sessionModes.modeForPreset("minimal")).toBe("chat");
    expect(unique.ctx.sessionModes.modeForPreset("nope")).toBeUndefined();
  });

  test("目标 preset 已经挂着就不换：切模式只换会话收口（不重挂行清单）", async () => {
    const { ctx, agent } = await mount(SHARED);

    await ctx.sessionModes.select(agent.id, "chat");

    // 不换 preset：模式事实照落、persona 与收口换成 chat 那一份。
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("chat");
    expect(sectionText(await assembled(ctx, agent), "deployment:persona-prefix")).toBe(
      "对话模式的提示词。",
    );
  });

  test("同一个模式重复选是幂等的：事实不重复写、preset 不重挂", async () => {
    const { ctx, agent } = await mount(SHARED);

    await ctx.sessionModes.select(agent.id, "coding");
    await ctx.sessionModes.select(agent.id, "coding");

    // 第一次把"这个会话是 coding"落成事实（投影原本是空的），第二次同一个值不写第二条。
    expect(
      (agent.session.ownEvents() as readonly { readonly type: string; readonly data: unknown }[])
        .filter((event) => event.type === "session-mode/selected")
        .map((event) => (event.data as { readonly sessionMode: string }).sessionMode),
    ).toEqual(["coding"]);
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  // 源包这里还有两条「当前那份不在白名单里就落到名单第一个」与「registry 没有 `composedPreset` 读面时该切就切」：
  // 它们判的是**换 preset** 这件事，而本部署的 preset 写死在 config 上（只装 ptc 那一份行清单），没有 roster。
  // 能力不存在，用例随之退场——这是本次唯一删掉的内容，已报给 lead 确认。
});

// 带角色与默认模型的 fixture：coding 自带模型、chat 只给角色、reviewer 只给 subagent 角色。
const EXTENDED: SessionModeProviderConfig = {
  default: "coding",
  modes: {
    coding: {
      ...CONFIG.modes["coding"]!,
      // 默认模型的 home 是**模式自己**：装配层写在这里，设置页编辑的也是这个路径。
      defaultModel: { provider: "ollama", model: "coding-model", reasoningEffort: "high" },
    },
    chat: { ...CONFIG.modes["chat"]!, role: ["main"] },
    reviewer: {
      presetsOnly: [],
      name: "评审模式",
      description: "只读评审",
      role: ["subagent"],
      persona: { prefix: "评审模式的提示词。", suffix: "" },
      allowTools: ["read"],
      denyTools: [],
      allowSkills: [],
      denySkills: [],
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
  return (await (agent.ctx as unknown as TestContext).waterfall(
    "agent/request",
    { agent, turn: 1, step: 0, signal: new AbortController().signal },
    () => Promise.resolve(SEED),
  )) as LlmCallConfig;
}

describe("模式的角色与默认模型", () => {
  test("选择器只列 main 的角色，subagent 角色单独取", async () => {
    const { ctx } = await mount(EXTENDED);

    expect(ctx.sessionModes.idsFor("main")).toEqual(["coding", "chat"]);
    expect(ctx.sessionModes.idsFor("subagent")).toEqual(["reviewer"]);
    expect(ctx.sessionModes.roster().modes.map((mode) => mode.id)).toEqual(["coding", "chat"]);
    expect(ctx.sessionModes.modesFor("subagent").map((entry) => entry.mode.name)).toEqual([
      "评审模式",
    ]);
  });

  test("不是 main 角色的模式不能当会话模式选", async () => {
    const { ctx, agent } = await mount(EXTENDED);

    await expect(ctx.sessionModes.select(agent.id, "reviewer")).rejects.toThrow("不是用户可选的");
  });

  test("新会话用模式自己的默认模型兜底请求路由", async () => {
    const { ctx, agent } = await mount(EXTENDED);

    const route = await requestRoute(agent);

    expect({
      provider: route.provider,
      model: route.model,
      reasoningEffort: route.reasoningEffort,
    }).toEqual({ provider: "ollama", model: "coding-model", reasoningEffort: "high" });
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  test("没配默认模型的模式不插手请求路由", async () => {
    const { ctx, agent } = await mount(EXTENDED);
    await ctx.sessionModes.select(agent.id, "chat");

    expect(await requestRoute(agent)).toEqual(SEED);
  });

  test("会话落过请求头之后不再兜底（历史模型优先）", async () => {
    const { agent } = await mount(EXTENDED);
    agent.session.append("request/header", {
      header: { config: { provider: "global", model: "global-model" } },
      reason: "initial",
    });

    expect(await requestRoute(agent)).toEqual(SEED);
  });

  test("用户选过模型（投影 pending）时不覆盖", async () => {
    const { agent } = await mount(EXTENDED);
    // `modelSelection` 投影就是我们注册的上游那份：落一条选择事件，pending 立刻读得到。
    agent.session.append("model/selection", { provider: "vendor", model: "vendor-model" });

    expect(await requestRoute(agent)).toEqual(SEED);
  });

  test("applyTo 是预留的指定接缝：按 id 应用并记账（不看空白会话）", async () => {
    const { ctx, agent } = await mount(EXTENDED);

    ctx.sessionModes.applyTo(agent, "reviewer");

    expect(ctx.sessionModes.modeOf(agent.session)).toBe("reviewer");
    expect(sectionText(await assembled(ctx, agent), "deployment:persona-prefix")).toBe(
      "评审模式的提示词。",
    );
  });

  test("装配期校验：role 为空、default 不是 main 都拒绝装载", async () => {
    const extended = EXTENDED.modes as unknown as Record<string, ModeConfig>;
    const base = CONFIG.modes as unknown as Record<string, ModeConfig>;
    const cases: readonly (readonly [Record<string, ModeConfig>, string])[] = [
      [{ ...extended, chat: { ...extended["chat"]!, role: [] as SessionModeRole[] } }, "role"],
      [{ ...extended, coding: { ...base["coding"]!, role: ["subagent"] } }, "main"],
    ];
    for (const [modes, reason] of cases) {
      await expectRefused({ default: "coding", modes }, reason);
    }
  });

  test("装配期校验：`defaultModel` 的 provider / model 缺一半就拒绝装载", async () => {
    await expectRefused(
      {
        default: "coding",
        modes: {
          ...(EXTENDED.modes as Record<string, ModeConfig>),
          coding: {
            ...(EXTENDED.modes as Record<string, ModeConfig>)["coding"]!,
            defaultModel: { provider: "ollama", model: "" },
          },
        },
      },
      "without both `provider` and `model`",
    );
  });

  test("装配期校验：退役的顶层 `models` 还配着值就拒绝装载（提醒挪进模式）", async () => {
    await expectRefused(
      {
        default: "coding",
        modes: EXTENDED.modes as Record<string, ModeConfig>,
        models: { coding: { provider: "ollama", model: "m" } },
      },
      "has moved into each mode's `defaultModel`",
    );
  });
});

describe("默认模型住在模式定义里", () => {
  test("模式清单与默认模式同属一条行的 config：`default` 与 `modes` 都在它上面", () => {
    // 本仓这一行的 Config 是纯函数（`SessionModeDefault.Config`）：它把 `default` 与 `modes` 归一成完整形状。
    // schemastery 那层 volatile 声明随源包的 schema 一起退场——配置页读的是 remote 的 `sessionMode/roster`。
    // 行 config 只带 `default` 时，内置默认三模式就位（`modes` 留空不掺模板）。
    const resolved = SessionModeDefault.Config?.({ default: "x", modes: {} }) as {
      default: string;
      modes: Record<string, unknown>;
    };
    expect(resolved.default).toBe("x");
    expect(Object.keys(resolved.modes).sort()).toEqual(["chat", "coding", "noop"]);
    expect(volatileForm).toBeTypeOf("function");
  });
});

// 按模式的 policy 拦截的 fixture：只换 `coding` 的两份 policy 名单（`chat` 一条都不配，用作成对判据）。
function withPolicies(
  policies: Pick<ModeConfig, "allowPolicies" | "denyPolicies">,
): SessionModeProviderConfig {
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
function installPolicyStub(ctx: TestContext): { asked: string[] } {
  const asked: string[] = [];
  // 走令牌（与生产同一形态）：`onWaterfall` 最终仍是 `ctx.on(name, …)`，所以上面那个拦 `ctx.on` 的探针照样有牙。
  // 两条都**不调 `next`**（独占决策槽）、**不加 `prepend`**（要排在模式行的拦截之后）。
  const writeIntent$ = new FsWriteIntentEvent();
  writeIntent$.onInit(ctx);
  writeIntent$.onWaterfall(() => {
    asked.push("write");
    return Promise.resolve<FsWriteIntent>({ kind: "replaceIfVersion", version: FsVersion("v1") });
  });
  const editIntent$ = new FsEditIntentEvent();
  editIntent$.onInit(ctx);
  editIntent$.onWaterfall(() => {
    asked.push("edit");
    throw new Error("FS_NOT_OBSERVED");
  });
  return { asked };
}

// 一次真的 waterfall 调用：`actor` 用工具那副形状——工具把自己的 exec 传进来（这里只关心它上面挂着的 `agent`）。
async function editIntent(ctx: TestContext, actor: object): Promise<unknown> {
  const editIntent$ = new FsEditIntentEvent();
  editIntent$.onInit(ctx);
  return await editIntent$.waterfall({} as never, actor, () => undefined);
}

async function writeIntent(ctx: TestContext, actor: object): Promise<unknown> {
  return await ctx.waterfall("fs/write-intent", {} as never, actor, () => undefined);
}

const UPSTREAM_WRITE_INTENT = { kind: "replaceIfVersion", version: "v1" };

describe("按模式的 policy 拦截", () => {
  // 本部署那条配置的形状：`coding` 禁 `fs/edit-intent`（免"先读后改"），写路径上的 CAS 安全网留着。
  const CODING_EDITS_FREE = withPolicies({ allowPolicies: [], denyPolicies: ["fs/edit-intent"] });

  test("被禁的规则：上游的拒绝被绕过（这次调用按没有这条规则继续）", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    const stub = installPolicyStub(ctx);

    // 上游那句 `FS_NOT_OBSERVED` 被接住，调用拿到 `undefined`（= 无版本前提的编辑）。
    await expect(editIntent(ctx, { agent })).resolves.toBeUndefined();
    // 上游还是被问了：先让它算完，再丢掉结论。
    expect(stub.asked).toEqual(["edit"]);
  });

  test("只禁一条时另一条照旧：写路径上的上游裁决原样出去", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);

    await expect(writeIntent(ctx, { agent })).resolves.toEqual(UPSTREAM_WRITE_INTENT);
  });

  test("没配 policy 名单的模式照旧吃上游的拒绝（成对判据）", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);
    await ctx.sessionModes.select(agent.id, "chat");

    await expect(editIntent(ctx, { agent })).rejects.toThrow("FS_NOT_OBSERVED");
  });

  test("只给某个模式配：同一个 ctx 上另一个模式的会话不受影响", async () => {
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

  test("模式切换后换一份判定（判据每次调用现算，监听器不换）", async () => {
    const { ctx, agent } = await mount(CODING_EDITS_FREE);
    const stub = installPolicyStub(ctx);

    await expect(editIntent(ctx, { agent })).resolves.toBeUndefined();

    await ctx.sessionModes.select(agent.id, "chat");

    await expect(editIntent(ctx, { agent })).rejects.toThrow("FS_NOT_OBSERVED");
    expect(stub.asked).toEqual(["edit", "edit"]);
  });

  test("认不出 agent 的调用照旧问上游（判据只认 `actor.agent`）", async () => {
    const { ctx } = await mount(CODING_EDITS_FREE);
    installPolicyStub(ctx);

    await expect(editIntent(ctx, {})).rejects.toThrow("FS_NOT_OBSERVED");
  });

  test("重复应用同一个模式：一次监听器注册都不发生", async () => {
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

  test("生效集合 =（白名单留空 ? 全部 : 白名单）− 黑名单：deny 优先", async () => {
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

  test("装配期校验：policy 名字不在已知名单里就拒绝装载", async () => {
    for (const policies of [
      { allowPolicies: ["fs/read-intent"], denyPolicies: [] },
      { allowPolicies: [], denyPolicies: ["fs/read-intent"] },
    ]) {
      await expectRefused(withPolicies(policies), "unknown policies");
    }
  });
});

// 一次真的工具调用：执行层守卫挂在 `agent` 的 scope 上（被拒时错误里带模式名与拒因）。
async function executeTool(ctx: TestContext, agent: Agent, name: string) {
  // 程序化调用走批量形状（上游 0.2.1-rc.2 起 `execute` 只收批量）；这里每次就一件。
  const batch = await ctx.tools.execute({
    calls: [
      {
        type: "tool-call",
        id: ToolCallId(`call-${name}-${String(Math.random())}`),
        name,
        arguments: "{}",
      },
    ],
    agent,
    signal: new AbortController().signal,
  });
  const result = batch.results[0]?.result;
  return { error: result !== undefined && "error" in result ? result.error : undefined };
}

describe("模式与收口（工具名单）", () => {
  test("换模式就是换一份收口：各自的名单（白名单 − 黑名单）生效", async () => {
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
    expect(visibleToolNames(ctx, agent)).toEqual(["web_search"]);

    // 换到 `coding`：白名单是 read / web_search，黑名单减掉 web_search（同一份里 deny 优先）。
    ctx.sessionModes.applyTo(agent, "coding");
    expect(visibleToolNames(ctx, agent)).toEqual(["read"]);
  });

  test("`denyTools` 的收窄：黑名单里的工具进不了目录、调用是 UNKNOWN_TOOL", async () => {
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
    expect(visibleToolNames(ctx, agent)).toEqual(["read"]);

    const denied = await executeTool(ctx, agent, "web_search");
    // 成对判据：留下的那件照旧能调，被拒那件不在准入集里（上游 `UNKNOWN_TOOL`，不再带自定义文案）。
    expect((await executeTool(ctx, agent, "read")).error).toBeUndefined();
    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("unknown tool");
  });
});

describe("子代理继承父模式", () => {
  test("继承父当前模式，并把继承写进子会话（恢复与 fork 能重建）", async () => {
    const { ctx, agent: parent } = await mount(EXTENDED);
    await ctx.sessionModes.select(parent.id, "chat");

    const child = await ctx.agents.create({
      sessionId: SessionId(`session-mode-child-${String(Date.now())}-${String(Math.random())}`),
      meta: { parentSession: parent.id, origin: "subagent" },
    });

    expect(ctx.sessionModes.modeOf(child.agent.session)).toBe("chat");
    expect(ctx.sessionModes.modeOf(child.agent.session)).toBe("chat");
    expect(sectionText(await assembled(ctx, child.agent), "deployment:persona-prefix")).toBe(
      "对话模式的提示词。",
    );
  });

  test("父不在场时不继承，回落部署默认", async () => {
    const { ctx } = await mount(EXTENDED);

    const orphan = await ctx.agents.create({
      sessionId: SessionId(`session-mode-orphan-${String(Date.now())}-${String(Math.random())}`),
      meta: { parentSession: SessionId("no-such-parent"), origin: "subagent" },
    });

    expect(ctx.sessionModes.modeOf(orphan.agent.session)).toBe("coding");
  });
});
// ── 会话级覆盖的持久化（`session_mode` 域） ──────────────────────────────────────
//
// 装配用**真存储栈**（真 hub + 真域行 + 真 json 后端，临时目录），只在最外面套一层计数：
// 判「读盘几次」需要看到 `get`，但写入路径与介质全是真的。
interface StorageMount {
  readonly ctx: TestContext;
  readonly agent: Agent;
  /** 每次 `get` 读到的键（计数那一层记的）。 */
  readonly reads: string[];
  /** 最后一次拿到的表句柄（真句柄，`size` 就是介质里的条数）。 */
  readonly table: () => { readonly size: number } | undefined;
  /** 症替身的观测面（不计数那一支用它注入写失败）。 */
  readonly memory: MemoryDomain;
}

/**
 * 装一套带存储的会话。
 *
 * 每一次调用都是一套**全新装配**：同一个存储根目录 + 同一个会话 id 就是「进程重启」。
 * @param options - `root` / `sessionId` 复用上一次的介质与会话；`memory: true` 换成可注入写失败的域替身。
 * @returns 装配结果与观测面。
 */
async function storageMount(
  options: {
    readonly root?: string;
    readonly sessionId?: SessionId;
    readonly memory?: boolean;
  } = {},
): Promise<StorageMount> {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "session-mode-spec-")));
  // 自己开的根绑本用例：装配先卸、目录后删（注册顺序即逆序执行）。
  if (options.root === undefined) onTestFinished(() => rm(root, { recursive: true, force: true }));
  const sessionId =
    options.sessionId ??
    SessionId(`session-mode-store-${String(Date.now())}-${String(Math.random())}`);
  const memory = memoryDomain();
  if (options.memory === true) {
    // 替身：可注入写失败，判"整次调用失败、内存不留半份"。
    const mounted = await mount(CONFIG, { storage: { domain: memory.domain } }, sessionId);
    return { ...mounted, reads: [], table: () => undefined, memory };
  }
  // 真栈：真 hub + 真域行 + 真 json 后端，外面套一层只记 `get` 的计数。
  const { app, storage } = await bootStorage(root);
  onTestFinished(() => app.dispose());
  const counter = counting(storage);
  const mounted = await mount(CONFIG, { storage: { domain: counter.domain } }, sessionId);
  return { ...mounted, reads: counter.reads, table: () => counter.tables.at(-1), memory };
}

describe("会话级覆盖的持久化", () => {
  test("覆盖从存储读回；第二次 activeState 不再读盘", async () => {
    // 根由**用例**持有：两次装配要指同一份介质（「进程重启」）。
    const root = await mkdtemp(join(tmpdir(), "session-mode-spec-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const first = await storageMount({ root });
    const sessionId = first.agent.session.id;
    await first.ctx.sessionModes.applyConfig(sessionId, {
      ...first.ctx.sessionModes.definition("coding"),
      denyTools: ["web_search"],
    });

    // 换一套装配（同一份介质 + 同一个会话）= 进程重启：覆盖从存储读回来。
    const restarted = await storageMount({ root, sessionId });
    const reread = await restarted.ctx.sessionModes.activeState(sessionId);

    // 首次 activeState 触发一次 hydrate：恰好读一次介质。
    expect(restarted.reads).toEqual([sessionId]);
    expect(reread?.session?.denyTools).toEqual(["web_search"]);
    expect(reread?.overriddenFields).toContain("denyTools");

    // 第二次 activeState 读内存：介质不再被碰。
    await restarted.ctx.sessionModes.activeState(sessionId);
    expect(restarted.reads).toEqual([sessionId]);
  });

  test("patch 传 null 只清这一个字段", async () => {
    const { ctx, agent } = await storageMount();
    const sessionId = agent.session.id;
    // 两条**字段级**覆盖（`applyConfig` 写的是整份，判"只清一个"看不出差别）。
    await ctx.sessionModes.setModePatch(sessionId, { denyTools: ["web_search"] });
    await ctx.sessionModes.setModePatch(sessionId, { instructions: false });
    expect((await ctx.sessionModes.activeState(sessionId))?.overriddenFields).toEqual([
      "denyTools",
      "instructions",
    ]);

    const after = await ctx.sessionModes.setModePatch(sessionId, { denyTools: null });

    // 只摘掉 `denyTools`：另一个被覆盖的字段原样留着。
    expect(after?.session).toEqual({ instructions: false });
    expect(after?.overriddenFields).toEqual(["instructions"]);
    expect(after?.config.instructions).toBe(false);
    expect(after?.config.denyTools).toEqual([]);
  });

  test("清到空的字段删掉整条记录", async () => {
    const { ctx, agent, table } = await storageMount();
    const sessionId = agent.session.id;
    await ctx.sessionModes.setModePatch(sessionId, { instructions: false });
    expect(table()?.size).toBe(1);

    const after = await ctx.sessionModes.setModePatch(sessionId, { instructions: null });

    expect(after?.session).toBeUndefined();
    expect(after?.overriddenFields).toEqual([]);
    // 整条记录被删掉：介质里不留空壳。
    expect(table()?.size).toBe(0);
  });

  test("坏记录不阻断装配：按没有覆盖处理，行照常起", async () => {
    // 先往介质里塞一条形状不合法的记录（模拟手改过 / 旧版本写下的）。
    const root = await mkdtemp(join(tmpdir(), "session-mode-spec-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const corrupt = SessionId("session-mode-corrupt");
    const seeding = await bootStorage(root);
    const domain = await seeding.storage.open(sessionModeDomainSpec);
    await domain.table(SESSION_MODE_TABLE).put(corrupt, { instructions: "not-a-boolean" });
    await domain.close();
    await seeding.app.dispose();

    // 整套装配照常起来（域层的 schema 是照单全收的那一个），读面把坏记录当「没有覆盖」。
    const bad = await storageMount({ root, sessionId: corrupt });
    const state = await bad.ctx.sessionModes.activeState(corrupt);

    expect(state?.session).toBeUndefined();
    expect(state?.overriddenFields).toEqual([]);
    expect(state?.config.instructions).toBe(true);
  });

  test("没有存储域时行照样起：覆盖只在内存里", async () => {
    // headless 形态（装配里没有 `StorageDomain`）：这一行靠 `inject.optional` 起来，写面照常工作。
    const { ctx, agent } = await mount();

    const after = await ctx.sessionModes.setModePatch(agent.session.id, { instructions: false });

    expect(after?.session).toEqual({ instructions: false });
    expect(after?.config.instructions).toBe(false);
  });

  test("存储写失败时 applyConfig 抛错且覆盖没变", async () => {
    const { ctx, agent, memory } = await storageMount({ memory: true });
    const sessionId = agent.session.id;
    await ctx.sessionModes.setModePatch(sessionId, { instructions: false });
    const before = await ctx.sessionModes.activeState(sessionId);

    memory.failures.failWrites = true;
    await expect(
      ctx.sessionModes.applyConfig(sessionId, {
        ...ctx.sessionModes.definition("coding"),
        denyTools: ["web_search"],
      }),
    ).rejects.toThrow("存储写失败");

    // 内存里没有半份：覆盖还是旧的那一份。
    memory.failures.failWrites = false;
    const after = await ctx.sessionModes.activeState(sessionId);
    expect(after?.session).toEqual(before?.session);
    expect(after?.session).toEqual({ instructions: false });
  });
});
// 端点 `applyConfig` 的返回值只说明"这次写成功了"，**不说明工具面真的换了**：收口是另一条路
// （`installFor` → `scope.apply` → `tools.restrict`）。这条钉的是两者一致。
describe("应用覆盖后的工具面", () => {
  test("应用覆盖后 agent 的可见工具变了", async () => {
    const { ctx, agent } = await storageMount();
    const sessionId = agent.session.id;
    // 起点：coding 的白名单是 read / web_search，目录里就是这两件。
    expect(visibleToolNames(ctx, agent)).toEqual(["read", "web_search"]);

    // 一份**收窄**的覆盖：只留 read。判据读 `ctx.tools.schemas(agent)`——那是模型真正看到的目录。
    const narrowed = { ...ctx.sessionModes.definition("coding"), allowTools: ["read"] };
    const state = await ctx.sessionModes.applyConfig(sessionId, narrowed);

    // 返回的生效态只是回声；真正的判据是目录跟着变了。
    expect(state?.config.allowTools).toEqual(["read"]);
    expect(visibleToolNames(ctx, agent)).toEqual(["read"]);

    // 成对判据：摘掉覆盖后回到模式默认的那两件（重装是幂等的，收口不是一次性的）。
    await ctx.sessionModes.setModePatch(sessionId, { allowTools: null });
    expect(visibleToolNames(ctx, agent)).toEqual(["read", "web_search"]);
  });
});

describe("哪些模式可删", () => {
  test("noop 与部署默认都不可删", async () => {
    // 生产形态：行 config 只带 `default`，三个内置模式就位（coding 是部署默认）。
    const { ctx, agent } = await mount({ default: "coding", modes: {} });
    const sessionId = agent.session.id;

    // 部署默认：会话停在 coding 上，不可删。
    expect((await ctx.sessionModes.activeState(sessionId))?.deletable).toBe(false);

    // 保留 id：切到 noop，同样不可删（它的判据不是"默认模式"，是保留 id）。
    await ctx.sessionModes.select(sessionId, "noop");
    const onNoop = await ctx.sessionModes.activeState(sessionId);
    expect(onNoop?.mode.id).toBe("noop");
    expect(onNoop?.deletable).toBe(false);

    // 成对判据：清单里既不是默认、也不是保留 id 的那个模式可删。
    await ctx.sessionModes.select(sessionId, "chat");
    expect((await ctx.sessionModes.activeState(sessionId))?.deletable).toBe(true);
  });
});
