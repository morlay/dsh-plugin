// 本部署的 preset 平面：**模式不限 preset**（两个模式都不声明 `presetsOnly`），行清单归会话挂着的那份——这里用
// 官方 `standard` 同形的行清单跑真装配（真 `Loader` + registry + 真上游行 + fs 与 skill 注册表）：工作区指令与
// 技能目录都由**官方行**注入，我们只做会话级收窄、文本转换，以及两条官方注入面的抑制（`agent/pre-step` 上丢）；
// chat 收成提问 + 联网三件、官方那两条注入面也都收掉（`instructions: false` + 工具名单推出来的 `skills: false`）；
// 切模式不换 preset；行清单里缺工具的 preset 上白名单一件都收不到。
// 取舍与代价见 `../.agents/adrs/20260929-模式不绑定preset.md` 与
// `../.agents/designs/20260929-抑制官方注入面.md`。

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import Group from "@deepseek-ai/cordis-plugin-group";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { agentEvents, assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import AgentPresets, { type PresetDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import * as FsObservationPolicy from "@deepseek-ai/dsh-fs-observation-policy";
import type { FsTarget } from "@deepseek-ai/dsh-fs";
import { ToolCallId, createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { renderContextSnapshot, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import WorkingDirectory from "@deepseek-ai/dsh-working-directory";
import * as contextPlugin from "@morlay/dsh-context-assembler";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as plugin from "../index.ts";
import { sessionModeRows } from "../rows.ts";

const contexts: Context[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const AGENTS_BODY = "先读 AGENTS.md。";
const SKILL = "repo-skill";
// 装在本部署里、但模式按名排除的那一类技能（形状与官方 `office-docx` 同：技能注册表里真的注册着）。
const DENIED_SKILL = "office-docx";

// 会话默认挂的那份 shipped preset（`standard`）的关键几行，与 `web-app/presets/standard.patch.yml` 同形：
// 上游的工作区指令与 `tool-skill` 行（注入的两面都归官方）、文件与 skill 发现、chat 收口要的两件。
const STANDARD_ROWS = [
  {
    id: "agent-instructions",
    name: "@deepseek-ai/dsh-agent-instructions",
    config: { maxBytes: 65_536 },
  },
  // 时钟：`standard` 从 0.2.1-alpha.1 起声明它，每步往请求历史注入一条带时间读数的 `user/message`。
  { id: "time-context", name: "@deepseek-ai/dsh-time-context", config: { refreshIntervalMs: 0 } },
  { id: "tool-fs", name: "@deepseek-ai/dsh-tool-fs" },
  { id: "skill-filesystem", name: "@deepseek-ai/dsh-skill-filesystem" },
  { id: "tool-skill", name: "@deepseek-ai/dsh-tool-skill" },
  { id: "tool-ask-user", name: "@deepseek-ai/dsh-tool-ask-user" },
  { id: "tool-web", name: "@deepseek-ai/dsh-tool-web", config: { fetch: true } },
] as const;

// 行清单里一件 chat 白名单工具都没有的 preset（官方 `minimal` 缺联网行的极端形）。
const BARE_ROWS = [{ id: "skill-filesystem", name: "@deepseek-ai/dsh-skill-filesystem" }] as const;

// 行按 Node 的解析基准从 **app 安装锚点**解析：与真部署 `loadProfileDirectory` 的 installAnchor 同一处。
function installAnchor(): string {
  return pathToFileURL(join(process.cwd(), "vendor/deepseek-harness/apps/cli/")).href;
}

// 我们通道注入的条目：幂等键在 source 的 `id` 上；上游那几条没有它——这正是分辨两侧的判据。
function entryIdOf(message: { readonly source: unknown }): string | undefined {
  const id = (message.source as { readonly id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function kindOf(message: { readonly source: unknown }): string {
  const kind = (message.source as { readonly kind?: unknown }).kind;
  return typeof kind === "string" ? kind : "";
}

function textOf(message: UserMessage): string {
  const [block] = message.content;
  return block?.type === "text" ? block.text : "";
}

function kindsOf(messages: readonly UserMessage[], kind: string): string[] {
  return messages
    .filter((message) => kindOf(message) === kind)
    .map((message) => entryIdOf(message) ?? "upstream");
}

// 技能目录那一条：官方 `tool-skill` 发布的（`kind: skill-catalog`）。
function catalogs(messages: readonly UserMessage[]): UserMessage[] {
  return messages.filter((message) => kindOf(message) === "skill-catalog");
}

// 目录消息里那份**结构化**名单（官方把发布的条目一起记在 source 上，消费方不用去解析给模型看的正文）。
function catalogEntries(message: UserMessage): string[] {
  const entries = (message.source as { readonly entries?: readonly { readonly name: string }[] })
    .entries;
  return (entries ?? []).map((entry) => entry.name).toSorted();
}

// 一条 preset 声明：`register` 的返回值要 `yield` 出去，声明方才有生命期。
async function declare(ctx: Context, definition: PresetDefinition): Promise<void> {
  await ctx.plugin({
    inject: ["agentPresets"],
    async *apply(child: Context) {
      yield await child.agentPresets.register(definition);
    },
  });
}

// 真装配：preset 平面（Loader + registry + 声明的行）与 host 平面（通道 + 模式行；收口在模式行内部）。
async function mount(options: {
  hostFirst: boolean;
  // 给某个模式的 config 补字段（用例用的覆盖，模式定义的真源仍是 `mode-sources.ts`）。
  modeOverrides?: Record<string, Record<string, unknown>>;
}) {
  const workspace = await mkdtemp(join(tmpdir(), "mode-preset-plane-"));
  dirs.push(workspace);
  await writeFile(join(workspace, ".git"), "");
  await writeFile(join(workspace, "AGENTS.md"), `# 工作区规则\n\n${AGENTS_BODY}`);

  const ctx = new Context();
  contexts.push(ctx);
  ctx.baseUrl = installAnchor();
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
  });
  await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SkillRegistry);
  ctx.skills.register({
    name: SKILL,
    description: "仓库自带的 skill。",
    content: "SKILL_BODY",
    source: "runtime",
    invocation: { modelInvocable: true, userInvocable: true },
  });
  ctx.skills.register({
    name: DENIED_SKILL,
    description: "模式按名排除的那一件。",
    content: "DENIED_SKILL_BODY",
    source: "runtime",
    invocation: { modelInvocable: true, userInvocable: true },
  });
  await ctx.plugin(LocalFileSystem, { cwd: "/" });
  // 上游 preset 行里的 `agent-instructions` / `tool-fs` / `tool-skill` 都 `inject` 这个服务（0.2.1-alpha.2 起）：
  // 装配里没有它就整行等在那里，preset 挂载直接判 `agent-preset/invalid`。
  await ctx.plugin(WorkingDirectory, { defaultDirectory: workspace });
  // provider 面替身：工具注册只要求服务在场（本用例不验 provider 行为）。
  ctx.provide("web", {} as never);
  ctx.provide("userQuestions", {} as never);

  const hostPlane = async (): Promise<void> => {
    // 通道只装本体（它不吃 config）：工作区指令与技能目录走官方行。
    await ctx.plugin(contextPlugin);
    // 上游那条"先读后改"策略：真部署里它在 base bundle 的 host 平面（`base/cordis.patch.yml`），
    // 在这两条 waterfall 上**独占决策槽**（它不调 `next()`）——模式的 policy 拦截要在它前面。
    await ctx.plugin(FsObservationPolicy);
    // 模式行：与装配入口渲染出来的那份 config 同源（`modeOverrides` 用来把"推导值"与"显式值"分开钉住）。
    const config = sessionModeRows()[0]?.insert?.[0]?.config;
    if (config === undefined) throw new Error("session-mode 行没有 config");
    const modes = config["modes"] as Record<string, Record<string, unknown>>;
    const overrides = options.modeOverrides ?? {};
    await ctx.plugin(plugin, {
      ...config,
      modes: Object.fromEntries(
        Object.entries(modes).map(([id, mode]) => [id, { ...mode, ...overrides[id] }]),
      ),
    } as never);
  };
  const presetPlane = async (): Promise<void> => {
    await ctx.plugin(Loader);
    // 组行（`cordis:group`）在真部署里是 loader 的内建（app-boot 设的）。
    (ctx.loader as unknown as { builtins: Record<string, unknown> }).builtins["group"] = Group;
    // 默认那份就是 shipped `standard`（本部署不再自建 preset）。
    await ctx.plugin(AgentPresets, { default: "standard" });
    await declare(ctx, { id: "standard", plugins: [...STANDARD_ROWS] });
    await declare(ctx, { id: "bare", plugins: [...BARE_ROWS] });
  };
  if (options.hostFirst) {
    await hostPlane();
    await presetPlane();
  } else {
    await presetPlane();
    await hostPlane();
  }

  const create = async (presetId?: string): Promise<Agent> => {
    const handle = await ctx.agents.create({
      sessionId: SessionId(
        `mode-preset-${presetId ?? "default"}-${String(Date.now())}-${String(Math.random())}`,
      ),
      meta: { cwd: workspace },
      setup: async (agentCtx: Context) => {
        await ctx.agentPresets.mount(agentCtx, presetId);
      },
    });
    return handle.agent;
  };
  return { ctx, create, workspace };
}

// 一次真的 fs 写 / 改意图调用：actor 用工具那副形状（它把自己的 exec 传进来，策略从 `actor.agent.session` 认归属），
// 链尾的默认是"无条件"（与 `tool-fs` 最内层那份同形）。
async function writeIntent(
  ctx: Context,
  target: FsTarget,
  agent: Agent,
): Promise<{ kind: string } | undefined> {
  return await ctx.waterfall("fs/write-intent", target, { agent }, () => undefined);
}

async function editIntent(ctx: Context, target: FsTarget, agent: Agent): Promise<unknown> {
  return await ctx.waterfall("fs/edit-intent", target, { agent }, () => undefined);
}

// 走真实通道：先 assemble（通道在那里收降级 section），再让 pre-step 注入。
// `persist` 时按真 loop 的"首试落盘"把这一步的消息追加进会话（落库判据要它）。
async function preStep(
  ctx: Context,
  agent: Agent,
  options: { turn?: number; persist?: boolean; extra?: readonly UserMessage[] } = {},
): Promise<UserMessage[]> {
  const input = [
    createUserMessage({ content: [{ type: "text", text: "任务" }], source: { kind: "user" } }),
    ...(options.extra ?? []),
  ];
  await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    { messages: input, turn: options.turn ?? 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: "enter" as const, messages: input }),
  );
  if (decision.kind !== "enter") return [];
  if (options.persist ?? false) {
    for (const message of decision.messages) {
      agent.session.append("user/message", message, { surfaceOp: "append" });
    }
  }
  return decision.messages;
}

async function toolNames(ctx: Context, agent: Agent): Promise<string[]> {
  const prompt = await ctx.systemPrompt.assemble(assembleContextFor(agent));
  return prompt.tools.map((tool) => tool.name).toSorted();
}

// 一次真的 `skill` 工具调用（官方的加载技能那件工具；`name` 是模型给的那个技能名）。
async function loadSkill(ctx: Context, agent: Agent, name: string) {
  return await ctx.tools.execute({
    callId: ToolCallId(`call-skill-${name}`),
    name: "skill",
    arguments: { name },
    agent,
    signal: new AbortController().signal,
  });
}

describe.each([
  { order: "host 平面先装" as const, hostFirst: true },
  { order: "preset 先装" as const, hostFirst: false },
])("模式是会话级扩展，行清单归会话挂的那份 preset（$order）", ({ hostFirst }) => {
  const mountBoth = (): ReturnType<typeof mount> => mount({ hostFirst });

  it("新会话挂的是 shipped 默认那份，模式按会话事实给（默认 coding）", async () => {
    const { ctx, create } = await mountBoth();

    expect(ctx.agentPresets.defaultId).toBe("standard");
    const agent = await create();
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe("standard");
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
  });

  it("提示词渲染：persona 里不留提示词变量，工作目录由上游那条运行时上下文给", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent));

    // 模式 persona 照旧在（人格提示词没被这场搬迁动过）。渲染本身就带判据：插值是严格的，persona 里残留任何
    // 未注册的 `{{变量}}` 都会在这里抛错——`cwd` 变量上游 0.2.1-alpha.2 起已不再注册。
    expect(renderPrompt(assembly)).toContain("经验丰富的编程专家");
    // 工作目录改由上游 `working-directory:current` 那条上下文给（模型看到的仍是同一件事）。
    expect(renderContextSnapshot(assembly)).toContain("Current working directory:");

    // chat 的 `runtimeContext: false` 收的是**可选**运行时上下文（快照与时钟），上游那条 required 的目录上下文
    // 照旧随装配注入——这条事实钉在这里，免得下次同步误以为 chat 连工作目录都不给。
    await ctx.sessionModes.select(agent.id, "chat");
    const chatAssembly = await ctx.systemPrompt.assemble(assembleContextFor(agent));
    expect(renderContextSnapshot(chatAssembly)).toContain("Current working directory:");
  });

  it("chat：联网三件可见可用，目录被收口到这三件", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();
    expect(await toolNames(ctx, agent)).toContain("read");

    await ctx.sessionModes.select(agent.id, "chat");

    expect(await toolNames(ctx, agent)).toEqual(["ask_user_question", "web_fetch", "web_search"]);
    for (const name of ["ask_user_question", "web_fetch", "web_search"]) {
      // 目录里有 = 注册表里真的注册着（不是被白名单收掉的假象）。
      expect(ctx.tools.get(name, agent), name).toBeDefined();
    }
  });

  it("chat：官方两条注入面都收掉，`skill` 也不在目录里、调用被拒", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();
    await ctx.sessionModes.select(agent.id, "chat");

    const messages = await preStep(ctx, agent);

    // 通道这一侧收干净了：没有我们注入的条目。
    expect(messages.filter((message) => entryIdOf(message) !== undefined)).toEqual([]);
    // 成对判据（coding 那份相反）：官方 `agent-instructions`（工作区指令）与官方 `skill-catalog`（技能目录）
    // 都收掉了——`instructions: false` 一条面、工具名单推出来的 `skills: false` 另一条面。
    expect(kindsOf(messages, "agent-instructions")).toEqual([]);
    expect(catalogs(messages)).toEqual([]);
    expect(messages.map(textOf).join("\n")).not.toContain(AGENTS_BODY);

    // 工具面的收窄照旧：`skill` 不进模型目录，真调用被收口拒（文案带模式名）。
    expect(await toolNames(ctx, agent)).not.toContain("skill");
    const denied = await ctx.tools.execute({
      callId: ToolCallId("call-skill-in-chat"),
      name: "skill",
      arguments: { name: SKILL },
      agent,
      signal: new AbortController().signal,
    });
    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("对话模式");
  });

  // 时钟（`time-context`）是**另一条**注入通道：它不经 `systemPrompt.suppressRuntimeContext()`，而是自己的
  // `agent/pre-step`（`prepend`，先委托再追加）。`runtimeContext: false` 说的是"不要动态快照"，所以它也要收。
  it("时钟：coding 每步一条，chat（`runtimeContext: false`）一条都没有、日志里也不留", async () => {
    const { ctx, create } = await mountBoth();
    const coding = await create();
    expect(kindsOf(await preStep(ctx, coding, { persist: true }), "time-context")).toHaveLength(1);

    const chat = await create();
    await ctx.sessionModes.select(chat.id, "chat");
    expect(kindsOf(await preStep(ctx, chat, { persist: true }), "time-context")).toEqual([]);

    // 落库判据：丢在注入之前——会话日志里没有时钟条目（不是"注入了再删"）。
    const stored = chat.session
      .ownEvents()
      .filter((event) => event.type === "user/message")
      .map((event) => kindOf(event.data));
    expect(stored).not.toContain("time-context");
  });

  it("chat：连续三步都不注入官方那两条，inbox 不积压、日志里一条都没有", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();
    await ctx.sessionModes.select(agent.id, "chat");

    for (const turn of [1, 2, 3]) {
      const messages = await preStep(ctx, agent, { turn, persist: true });
      expect(kindsOf(messages, "agent-instructions"), `turn ${String(turn)}`).toEqual([]);
      expect(catalogs(messages), `turn ${String(turn)}`).toEqual([]);
      // 官方那两行把待送内容记在 inbox 上：丢的是**本步**的注入，不该攒在 inbox 里等下一步再来一遍。
      expect(agent.inbox.nextStep, `turn ${String(turn)}`).toEqual([]);
    }

    // 落库判据：会话日志里没有这两类条目（丢在注入之前，不是"注入了再删"）。
    const stored = agent.session
      .ownEvents()
      .filter((event) => event.type === "user/message")
      .map((event) => kindOf(event.data));
    expect(stored).not.toContain("agent-instructions");
    expect(stored).not.toContain("skill-catalog");
  });

  it("显式 `skills: true` 压过名单推导：名单里没有 `skill`，技能目录仍由官方那一行发布", async () => {
    const { ctx, create } = await mount({ hostFirst, modeOverrides: { chat: { skills: true } } });
    const agent = await create();
    await ctx.sessionModes.select(agent.id, "chat");

    const messages = await preStep(ctx, agent);

    // 显式值说的是"注入面要不要"：目录照旧发布。
    expect(catalogs(messages)).toHaveLength(1);
    expect(textOf(catalogs(messages)[0]!)).toContain(SKILL);
    // 工具面照旧按名单收窄（`skills` 不管工具可见性），另一条面（工作区指令）也照旧不进来。
    expect(await toolNames(ctx, agent)).toEqual(["ask_user_question", "web_fetch", "web_search"]);
    expect(kindsOf(messages, "agent-instructions")).toEqual([]);
  });

  it("coding：行清单的全部工具都在；技能目录由官方那一行发布", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();

    const tools = await toolNames(ctx, agent);
    for (const name of ["read", "write", "edit", "web_search", "ask_user_question", "skill"]) {
      expect(tools, `coding 少了 ${name}`).toContain(name);
    }

    const messages = await preStep(ctx, agent);
    const catalogs_ = catalogs(messages);

    // 目录是官方 `tool-skill` 那份（我们没有自己的 skill-catalog capability 了）。
    expect(catalogs_).toHaveLength(1);
    expect(textOf(catalogs_[0]!)).toContain(SKILL);
    // 工作区指令也由上游那一行给：我们通道不重复注入。
    expect(kindsOf(messages, "agent-instructions")).toEqual(["upstream"]);
  });

  it("技能黑名单：被拒的技能从目录里拿掉，其余技能照旧（成对：不配名单时两件都在）", async () => {
    const { ctx, create } = await mount({
      hostFirst,
      modeOverrides: {
        coding: { denySkills: [DENIED_SKILL] },
        // 成对的那一份：chat 显式要目录（它自己的工具名单推不出"要"），技能名单一条都不配。
        chat: { skills: true },
      },
    });
    const agent = await create();

    const [catalog] = catalogs(await preStep(ctx, agent));

    expect(catalog).toBeDefined();
    // 模型读到的正文收窄；官方发布的那份结构化名单原样留着（官方按它的 digest 判目录变没变，改它会每步重发）。
    expect(textOf(catalog!)).toContain(SKILL);
    expect(textOf(catalog!)).toContain("仓库自带的 skill。");
    expect(textOf(catalog!)).not.toContain(DENIED_SKILL);
    expect(catalogEntries(catalog!)).toEqual([DENIED_SKILL, SKILL].toSorted());

    // 成对判据：另一份**没配技能名单**的定义里两件都在——"把目录整份丢掉"那种实现过不了这一条。
    const other = await create();
    await ctx.sessionModes.select(other.id, "chat");
    const [otherCatalog] = catalogs(await preStep(ctx, other));
    expect(catalogEntries(otherCatalog!)).toEqual([DENIED_SKILL, SKILL].toSorted());
  });

  it("技能名单不反复发布目录：连续三步只发布一次（收窄不打断官方的历史 digest）", async () => {
    const { ctx, create } = await mount({
      hostFirst,
      modeOverrides: { coding: { denySkills: [DENIED_SKILL] } },
    });
    const agent = await create();

    const steps: UserMessage[][] = [];
    for (const turn of [1, 2, 3]) steps.push(await preStep(ctx, agent, { turn, persist: true }));

    // 官方按"历史里可见那份目录"的 digest 判要不要再发一条：收窄只改模型可见的正文时它稳定；连结构化名单
    // 一起改会让 digest 永远对不上，于是每一步都重发一条目录（这条用例就是钉住那件事）。
    expect(catalogs(steps[0]!).length).toBe(1);
    expect(catalogs(steps[1]!)).toEqual([]);
    expect(catalogs(steps[2]!)).toEqual([]);
    const stored = agent.session
      .ownEvents()
      .filter((event) => event.type === "user/message" && kindOf(event.data) === "skill-catalog");
    expect(stored).toHaveLength(1);
  });

  it("技能黑名单：`skill` 工具加载被拒的技能被拒，别的技能照旧可加载", async () => {
    const { ctx, create } = await mount({
      hostFirst,
      modeOverrides: { coding: { denySkills: [DENIED_SKILL] } },
    });
    const agent = await create();

    const denied = await loadSkill(ctx, agent, DENIED_SKILL);

    expect(denied.error).toBeDefined();
    expect(JSON.stringify(denied)).toContain("编码模式");
    expect(JSON.stringify(denied)).toContain("技能黑名单");
    // 成对：名单只排除那一件，别的技能照旧加载得到。
    expect((await loadSkill(ctx, agent, SKILL)).error).toBeUndefined();
  });

  it("技能白名单：名单外的技能从目录里拿掉，`skill` 工具加载它也被拒", async () => {
    const { ctx, create } = await mount({
      hostFirst,
      // 源定义里 `coding` 本来就带技能黑名单（官方 Office 三件）：这一份换成纯白名单，两类拒绝才分得开。
      modeOverrides: { coding: { allowSkills: [SKILL], denySkills: [] } },
    });
    const agent = await create();

    const [catalog] = catalogs(await preStep(ctx, agent));

    // 正文收窄成名单里那一件；官方发布的结构化名单原样留着（同一条理由：那是官方 digest 的输入）。
    expect(catalogEntries(catalog!)).toEqual([DENIED_SKILL, SKILL].toSorted());
    expect(textOf(catalog!)).not.toContain(DENIED_SKILL);

    const denied = await loadSkill(ctx, agent, DENIED_SKILL);
    expect(JSON.stringify(denied)).toContain("技能白名单");
    expect((await loadSkill(ctx, agent, SKILL)).error).toBeUndefined();
  });

  it("目录行格式漂移：那一条整条不动（正文与名单不分叉），告警点名被拒的那件没被拿掉", async () => {
    const { ctx, create } = await mount({
      hostFirst,
      modeOverrides: { coding: { denySkills: [DENIED_SKILL] } },
    });
    const warn = vi.spyOn(ctx.logger, "warn").mockImplementation(() => undefined);
    const agent = await create();
    // 官方那一行只认**第一条**目录消息（它把它换成自己渲染的那份），所以这里放两条：第一条喂给官方行，
    // 第二条就是"上游渲染形状变了"的那一条——它留到过滤面上，`- \`名字\`: ` 那个行首认不出。
    const replaced = createUserMessage({
      content: [
        { type: "text", text: "<available_skills>\n- `office-docx`: 自造\n</available_skills>" },
      ],
      source: {
        kind: "skill-catalog",
        form: "catalog",
        entries: [{ name: DENIED_SKILL, description: "自造" }],
      } as never,
    });
    const drift = createUserMessage({
      content: [
        {
          type: "text",
          text: "<available_skills>\n* office-docx: 漂移形状\n</available_skills>",
        },
      ],
      source: {
        kind: "skill-catalog",
        form: "catalog",
        entries: [{ name: DENIED_SKILL, description: "漂移形状" }],
      } as never,
    });

    const messages = await preStep(ctx, agent, { extra: [replaced, drift] });
    const catalogList = catalogs(messages);
    const official = catalogList.find((message) => !textOf(message).includes("漂移形状"))!;
    const drifted = catalogList.find((message) => textOf(message).includes("漂移形状"))!;

    // 官方发布的那条照旧被收窄（正文）；认不出行的那一条整条不动，并点名告警。
    expect(catalogEntries(official)).toEqual([DENIED_SKILL, SKILL].toSorted());
    expect(catalogEntries(drifted)).toEqual([DENIED_SKILL]);
    expect(warn.mock.calls.flat().join("\n")).toContain(DENIED_SKILL);
  });

  it("`skills` 推导的减法那一半：名单留空 + 黑名单禁掉 `skill` → 技能目录不注入", async () => {
    const { ctx, create } = await mount({
      hostFirst,
      modeOverrides: { coding: { denyTools: ["skill"] } },
    });
    const agent = await create();

    const messages = await preStep(ctx, agent);

    // 起点是"全部工具"（`coding` 不写 `allowTools`），黑名单减掉 `skill` → 推导成"不要技能目录"。
    expect(catalogs(messages)).toEqual([]);
    // 同一条路上的成对判据：`instructions` 没关，官方那条工作区指令照旧在；`skill` 也不在模型目录里。
    expect(kindsOf(messages, "agent-instructions")).toEqual(["upstream"]);
    const tools = await toolNames(ctx, agent);
    expect(tools).toContain("read");
    expect(tools).not.toContain("skill");
  });

  it("切模式不换 preset：chip 在 coding ↔ chat 之间来回，只换会话收口", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();
    const recomposes: string[] = [];
    const registry = ctx.agentPresets;
    const recompose = registry.recompose.bind(registry);
    registry.recompose = (agentCtx: Context, id: string) => {
      recomposes.push(id);
      return recompose(agentCtx, id);
    };

    await ctx.sessionModes.select(agent.id, "chat");
    await ctx.sessionModes.select(agent.id, "coding");
    await ctx.sessionModes.select(agent.id, "chat");

    // 模式不限 preset（名单留空）：一次 recompose 都没发生，模式事实照落。
    expect(recomposes).toEqual([]);
    expect(
      agent.session.ownEvents().filter((event) => event.type === "agent-preset/selected"),
    ).toEqual([]);
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe("standard");
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("chat");
    expect(await toolNames(ctx, agent)).toEqual(["ask_user_question", "web_fetch", "web_search"]);
  });

  it("按模式的 policy 拦截：coding 两条上游规则都免掉，chat 照旧吃上游的拒绝", async () => {
    const { ctx, create, workspace } = await mountBoth();
    const agent = await create();
    const target = await ctx.fs.resolve(join(workspace, "notes.md"));

    // coding（源数据里两条都禁）：真策略的「先读后改」与写意图判定都被绕过 → 两条都不再由策略回答。
    await expect(editIntent(ctx, target, agent)).resolves.toBeUndefined();
    await expect(writeIntent(ctx, target, agent)).resolves.toBeUndefined();

    await ctx.sessionModes.select(agent.id, "chat");

    // chat 一条 policy 都没配：真策略照旧拒绝（成对判据）。
    await expect(editIntent(ctx, target, agent)).rejects.toMatchObject({ code: "FS_NOT_OBSERVED" });
    expect(await writeIntent(ctx, target, agent)).toEqual({ kind: "createIfAbsent" });
  });

  it("行清单里缺工具的 preset：白名单一件都收不到（代价照实钉住）", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create("bare");

    await ctx.sessionModes.select(agent.id, "chat");

    // `bare` 那份只有 skill 发现：chat 的三件一个都不在（"preset 没有的工具自动跳过"）。
    expect(await toolNames(ctx, agent)).toEqual([]);
  });
});
