/**
 * 本部署的 preset 平面：**两个模式共享一份自己注册的 preset** 时，会话各自拿到什么。
 *
 * 复用官方 preset 的两处耦合（`chat` 挂的 `minimal` 没有 `tool-web`，联网三件收口后一件都不剩；preset 自带
 * 的上游注入要在我们的开关之外让位）在这里验：行清单归我们之后，两个模式的差异只由会话级收口表达——
 *
 * 1. `chat`：`web_search` / `web_fetch` / `ask_user_question` 三件在目录里，别的都被白名单收掉，注入 0 条；
 * 2. `coding`：文件工具与联网都在；注入只有**我们那一份**技能目录（kind 是 `context-assembler`）；
 * 3. 官方 preset 的会话照旧：工作区指令让位给上游那一行，skill 面仍是我们抢到的那份。
 *
 * 真装配：真 `Loader` + 真 registry + 真上游行（行按**app 安装锚点**解析，与真部署同一处）＋ 真 fs 与 skill
 * 注册表。行清单从 `TOOLKIT_PRESET_ROWS` 派生（与 `bundles/session-mode-profile` 声明的那份同源），这里只取
 * 本用例要验的族——整条清单的形状由那个 bundle 的 `patch.spec.ts` 逐行钉住。
 *
 * 两个 provider 面用替身（`web` / `userQuestions`）：本用例回答的是"这些工具由 preset 的行注册出来、并在
 * 这个会话的目录里"，不是 provider 自己的行为（那由各自包与真 profile 探针负责）。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { TOOLKIT_PRESET_ROWS, type PresetRow } from "@morlay/dsh-agent-toolkit/rows";
import * as contextPlugin from "@morlay/dsh-context-assembler";
import * as contextScope from "@morlay/dsh-context-assembler/scope";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";
import { MODE_PRESET_ID, sessionModeRows } from "../rows.ts";

const contexts: Context[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const AGENTS_BODY = "先读 AGENTS.md。";
const SKILL = "repo-skill";
/** 通道注册的那份 `skill` 工具的描述（上游那份是英文的，用它分辨谁赢了）。 */
const OUR_TOOL_DESCRIPTION = "按需加载 skill 的完整说明。";

/** 行按 Node 的解析基准从 **app 安装锚点**解析：与真部署 `loadProfileDirectory` 的 installAnchor 同一处。 */
function installAnchor(): string {
  return pathToFileURL(join(process.cwd(), "vendor/deepseek-harness/apps/cli/")).href;
}

/**
 * 本用例要的那几行：问答、文件、skill 发现、联网——**从真清单里按 id 取**（族归属不影响装配，扁平摆进
 * preset 即可）。上游改行 id / 我们改族名都会在这里显形。
 */
const WANTED_ROWS: readonly string[] = ["tool-ask-user", "tool-fs", "skill-filesystem", "tool-web"];

/** 清单里出现的全部行（含族组的子行）。 */
function flatRows(rows: readonly PresetRow[]): readonly PresetRow[] {
  return rows.flatMap((row) => [
    row,
    ...flatRows(Array.isArray(row.config) ? (row.config as readonly PresetRow[]) : []),
  ]);
}

function fixturePresetRows(): readonly PresetRow[] {
  const all = flatRows(TOOLKIT_PRESET_ROWS);
  return WANTED_ROWS.map((id) => {
    const row = all.find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error(`preset 行清单里少了 ${id}`);
    return row;
  });
}

/** 官方 preset 的那两行（让位 / 抢面的对照）：模块名与 `web-app/presets/*.patch.yml` 一字不差。 */
const STANDARD_ROWS = [
  {
    id: "agent-instructions",
    name: "@deepseek-ai/dsh-agent-instructions",
    config: { maxBytes: 65_536 },
  },
  { id: "tool-skill", name: "@deepseek-ai/dsh-tool-skill" },
] as const;

/** 通道注入的条目：幂等键在 source 的 `id` 上；上游那几条没有它——这正是分辨两侧的判据。 */
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

/** 技能目录那一条：我们那份带 `id: skill-catalog`，上游那份没有 id（只有 kind）。 */
function catalogs(messages: readonly UserMessage[]): UserMessage[] {
  return messages.filter(
    (message) => entryIdOf(message) === "skill-catalog" || kindOf(message) === "skill-catalog",
  );
}

/** 一条 preset 声明：`register` 的返回值要 `yield` 出去，声明方才有生命期。 */
async function declare(ctx: Context, definition: PresetDefinition): Promise<void> {
  await ctx.plugin({
    inject: ["agentPresets"],
    async *apply(child: Context) {
      yield await child.agentPresets.register(definition);
    },
  });
}

/** 真装配：preset 平面（Loader + registry + 声明的行）与 host 平面（通道 + 收口行 + 工具说明 + 模式行）。 */
async function mount(options: { hostFirst: boolean }) {
  const workspace = await mkdtemp(join(tmpdir(), "mode-preset-plane-"));
  const home = join(workspace, "home");
  dirs.push(workspace);
  await mkdir(home, { recursive: true });
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
  await ctx.plugin(LocalFileSystem, { cwd: "/" });
  // provider 面替身：工具注册只要求服务在场（本用例不验 provider 行为）。
  ctx.provide("web", {} as never);
  ctx.provide("userQuestions", {} as never);

  const hostPlane = async (): Promise<void> => {
    await ctx.plugin(contextPlugin, {
      capabilities: ["assembler", "agent-instructions", "skill-catalog"],
      options: { "agent-instructions": { dshHome: home } },
    });
    await ctx.plugin(contextScope);
    // 模式行：与装配入口渲染出来的那份 config 同源。
    const config = sessionModeRows()[0]?.insert?.[0]?.config;
    if (config === undefined) throw new Error("session-mode 行没有 config");
    await ctx.plugin(plugin, config as never);
  };
  const presetPlane = async (): Promise<void> => {
    await ctx.plugin(Loader);
    // 组行（`cordis:group`）在真部署里是 loader 的内建（app-boot 设的）。
    (ctx.loader as unknown as { builtins: Record<string, unknown> }).builtins["group"] = Group;
    await ctx.plugin(AgentPresets, { default: MODE_PRESET_ID });
    await declare(ctx, {
      id: MODE_PRESET_ID,
      name: "模式切换",
      plugins: fixturePresetRows() as unknown as PresetDefinition["plugins"],
    });
    await declare(ctx, { id: "standard", plugins: [...STANDARD_ROWS] });
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
  return { ctx, create };
}

/** 走真实通道：先 assemble（通道在那里收降级 section），再让 pre-step 注入。 */
async function preStep(ctx: Context, agent: Agent): Promise<UserMessage[]> {
  const input = [
    createUserMessage({ content: [{ type: "text", text: "任务" }], source: { kind: "user" } }),
  ];
  await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    { messages: input, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: "enter" as const, messages: input }),
  );
  return decision.kind === "enter" ? decision.messages : [];
}

async function toolNames(ctx: Context, agent: Agent): Promise<string[]> {
  const prompt = await ctx.systemPrompt.assemble(assembleContextFor(agent));
  return prompt.tools.map((tool) => tool.name).toSorted();
}

describe.each([
  { order: "host 平面先装" as const, hostFirst: true },
  { order: "preset 先装" as const, hostFirst: false },
])("两个模式共享自己注册的 preset（$order）", ({ hostFirst }) => {
  const mountBoth = (): ReturnType<typeof mount> => mount({ hostFirst });

  it("新会话默认挂我们那份：模式按会话事实给（默认 coding）", async () => {
    const { ctx, create } = await mountBoth();

    expect(ctx.agentPresets.defaultId).toBe(MODE_PRESET_ID);
    const agent = await create();
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe(MODE_PRESET_ID);
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("coding");
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

  it("chat：注入 0 条（instructions: false），工作区指令也不从 preset 那一侧漏进来", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();
    await ctx.sessionModes.select(agent.id, "chat");

    const messages = await preStep(ctx, agent);

    expect(messages.filter((message) => kindOf(message) !== "user")).toEqual([]);
    expect(messages.map(textOf).join("\n")).not.toContain(AGENTS_BODY);
    expect(catalogs(messages)).toEqual([]);
  });

  it("coding：文件与联网都在，注入只有我们那一份技能目录（kind 是 context-assembler）", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create();

    // 本用例的 preset 只取 `tool-fs`（`tool-fs-search` 要 `subprocess`，整条清单的形状由 bundle 的
    // patch 测试逐行钉住）：文件那族与联网都在目录里。
    const tools = await toolNames(ctx, agent);
    for (const name of ["read", "write", "edit", "web_search", "skill"]) {
      expect(tools, `coding 少了 ${name}`).toContain(name);
    }

    const messages = await preStep(ctx, agent);
    const catalogs_ = catalogs(messages);

    expect(catalogs_).toHaveLength(1);
    expect(entryIdOf(catalogs_[0]!)).toBe("skill-catalog");
    expect(kindOf(catalogs_[0]!)).toBe("context-assembler");
    expect(textOf(catalogs_[0]!)).toContain(SKILL);
    // 工作区指令也只有我们那一份（preset 里没有上游 `agent-instructions` 行）。
    expect(kindsOf(messages, "agent-instructions")).toEqual([
      expect.stringMatching(/^agent-instructions:[0-9a-f]{8}:AGENTS\.md$/u),
    ]);
    expect(messages.map(textOf).join("\n")).toContain(AGENTS_BODY);
  });

  it("切模式不重挂 preset（chip 在 coding ↔ chat 之间来回，只换会话收口）", async () => {
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

    // 目标 preset 与当前相同：一次 recompose 都没发生，模式事实照落。
    expect(recomposes).toEqual([]);
    expect(
      agent.session.ownEvents().filter((event) => event.type === "agent-preset/selected"),
    ).toEqual([]);
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe(MODE_PRESET_ID);
    expect(ctx.sessionModes.modeOf(agent.session)).toBe("chat");
    expect(await toolNames(ctx, agent)).toEqual(["ask_user_question", "web_fetch", "web_search"]);
  });

  it("官方 preset 的会话不受影响：工作区指令让位给上游，skill 面仍是我们抢到的", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create("standard");

    const messages = await preStep(ctx, agent);

    expect(kindsOf(messages, "agent-instructions")).toEqual(["upstream"]);
    expect(ctx.tools.get("skill", agent)?.description).toBe(OUR_TOOL_DESCRIPTION);
    // skill 面照旧归我们：只有我们那份目录（上游 `tool-skill` 那一份被遮蔽后闭嘴）。
    const catalogs_ = catalogs(messages);
    expect(catalogs_).toHaveLength(1);
    expect(entryIdOf(catalogs_[0]!)).toBe("skill-catalog");
    expect(kindOf(catalogs_[0]!)).toBe("context-assembler");
    expect(textOf(catalogs_[0]!)).toContain(SKILL);
  });
});
