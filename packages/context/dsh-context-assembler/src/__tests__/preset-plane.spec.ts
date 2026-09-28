/**
 * preset 平面的两条边界——**工作区指令让位、skill 面抢面**。
 *
 * 两条都只能在**真装配**里验：preset 的行清单住在 `agent-presets` 注册表持有的 scope 里
 * （[`mount.ts`](../../../vendor/deepseek-harness/packages/preset/agent-preset-registry/src/mount.ts)），
 * 静态测试看不见。所以这里挂真注册表、真上游行（`@deepseek-ai/dsh-agent-instructions` /
 * `@deepseek-ai/dsh-tool-skill`）与真 fs，再数一步里到底注入了几条：
 *
 * - 工作区指令：`standard` 那种行清单（上游那一行在）→ 上游那份是唯一一份；`minimal` 没有 → 我们提供；
 * - skill 面：`standard` 会话里 `skill` 工具是**我们**的（按会话注册进 agent 自己那一层，遮蔽 preset 那份），
 *   目录因此只有我们一份；`minimal` 会话里也是我们；
 * - 空白窗口里换 preset → 两条边界的结论都跟着换。
 *
 * 装配顺序两个方向都跑（host 平面先装 / preset 先装）：抢面靠的是 tools 注册表的分层（最近的一层赢），
 * 与事件监听器的注册顺序无关——上游 `tool-skill` 的目录判据是"它的工具是否本会话可见"，而我们那份在最里层。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
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
import type { Config as SessionModeConfig } from "@morlay/dsh-session-mode";
import { afterEach, describe, expect, it } from "vitest";
import * as sessionMode from "@morlay/dsh-session-mode";
import * as contextScope from "../scope/index.ts";
import * as plugin from "../index.ts";

const contexts: Context[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const AGENTS_BODY = "先读 AGENTS.md。";
const SKILL = "repo-skill";
const OUR_TOOL_DESCRIPTION = "按需加载 skill 的完整说明。";

/** 官方 preset 的那两行：模块名与 `web-app/presets/*.patch.yml` 里的一字不差。 */
const STANDARD_ROWS = [
  {
    id: "agent-instructions",
    name: "@deepseek-ai/dsh-agent-instructions",
    config: { maxBytes: 65_536 },
  },
  { id: "tool-skill", name: "@deepseek-ai/dsh-tool-skill" },
] as const;

const PRESETS = { standard: STANDARD_ROWS, minimal: [] } as const;

/**
 * 模式定义（会话级扩展）：`standard` ↔ coding、`minimal` ↔ chat。只有需要验"选模式 = 换 preset realm"的用例
 * 才挂这一行——其余用例验的是 preset 平面本身，不掺会话收口。
 */
const MODES: SessionModeConfig = {
  default: "coding",
  modes: {
    coding: {
      preset: "standard",
      name: "编码模式",
      description: "编码",
      role: ["main"],
      persona: { prefix: "编码模式的提示词。", suffix: "" },
      allowTools: ["read", "web_search", "ask_user_question", "skill"],
      instructions: true,
      runtimeContext: true,
    },
    chat: {
      preset: "minimal",
      name: "对话模式",
      description: "对话",
      role: ["main"],
      persona: { prefix: "对话模式的提示词。", suffix: "" },
      allowTools: ["ask_user_question", "web_search", "web_fetch"],
      instructions: false,
      runtimeContext: false,
    },
  },
};

/** 通道注入的条目：幂等键在 source 的 `id` 上；上游那几条没有它——这正是分辨两侧的判据。 */
function entryIdOf(message: { readonly source: unknown }): string | undefined {
  const id = (message.source as { readonly id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function textOf(message: UserMessage): string {
  const [block] = message.content;
  return block?.type === "text" ? block.text : "";
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
}

/** 一侧一个标记：`upstream` 是上游那条（没有幂等键），其余是我们那条（带 id）。 */
function kindsOf(messages: readonly UserMessage[], kind: string): string[] {
  return messages
    .filter((message) => message.source.kind === kind)
    .map((message) => entryIdOf(message) ?? "upstream");
}

function bodyOf(messages: readonly UserMessage[], kind: string): string {
  const message = messages.find((candidate) => candidate.source.kind === kind);
  return message === undefined ? "" : textOf(message);
}

/**
 * 目录那一条：我们那份的 kind 是自己的（`context-assembler`，见 `skill-catalog/index.ts`），上游那份是
 * `skill-catalog` —— 所以按"id 或 kind"两路都收，再按有没有上游那个 id 分辨两侧。
 */
function catalogs(messages: readonly UserMessage[]): UserMessage[] {
  return messages.filter(
    (message) => entryIdOf(message) === "skill-catalog" || message.source.kind === "skill-catalog",
  );
}

function catalogKinds(messages: readonly UserMessage[]): string[] {
  return catalogs(messages).map((message) => entryIdOf(message) ?? "upstream");
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

/**
 * 规则的安装是 `agent/created` 里的异步动作（要读指令链），没有可 await 的承诺。挂一个观察点，
 * 等规则真的注册上再断言——否则"没有注入"可能只是"还没装上"。
 */
function watchRules(ctx: Context): {
  readonly registered: readonly string[];
  until(prefix: string): Promise<void>;
} {
  const registered: string[] = [];
  const channel = ctx.contextAssembler;
  const register = channel.registerRule.bind(channel);
  channel.registerRule = (declaration) => {
    registered.push(declaration.id);
    return register(declaration);
  };
  return {
    registered,
    until: async (prefix) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (registered.some((id) => id.startsWith(prefix))) return;
        await new Promise((settle) => {
          setTimeout(settle, 5);
        });
      }
      throw new Error(`规则 ${prefix}* 一直没注册上`);
    },
  };
}

/** 真装配：preset 平面（`Loader` + 注册表 + 声明的行）与 host 平面（通道 + 三项能力）。 */
async function mount(options: {
  readonly presets: Record<string, readonly unknown[]>;
  readonly hostFirst: boolean;
  /** 给了就再挂会话模式那一套（收口行 + `session-mode`）：验"选模式 = 换 preset realm"。 */
  readonly modes?: SessionModeConfig;
}) {
  const workspace = await mkdtemp(join(tmpdir(), "preset-plane-"));
  const home = join(workspace, "home");
  dirs.push(workspace);
  await mkdir(home, { recursive: true });
  await writeFile(join(workspace, ".git"), "");
  await writeFile(join(workspace, "AGENTS.md"), `# 工作区规则\n\n${AGENTS_BODY}`);

  const ctx = new Context();
  contexts.push(ctx);
  // preset 的行按模块名从声明方的 baseUrl 解析：指回包根，`node_modules` 在那里。
  ctx.baseUrl = new URL("../../", import.meta.url).href;
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

  const hostPlane = async (): Promise<void> => {
    await ctx.plugin(plugin, {
      capabilities: ["assembler", "agent-instructions", "skill-catalog"],
      // `dshHome` 指到空目录：免得读进跑测试这台机器的 `~/.dsh`（上游那行的 `maxBytes` 与它同源）。
      options: { "agent-instructions": { dshHome: home } },
    });
    if (options.modes !== undefined) {
      await ctx.plugin(contextScope);
      await ctx.plugin(sessionMode, options.modes);
    }
  };
  const presetPlane = async (): Promise<void> => {
    await ctx.plugin(Loader);
    await ctx.plugin(AgentPresets, { default: "standard" });
    for (const [id, rows] of Object.entries(options.presets)) {
      await declare(ctx, { id, plugins: rows as PresetDefinition["plugins"] });
    }
  };
  if (options.hostFirst) {
    await hostPlane();
    await presetPlane();
  } else {
    await presetPlane();
    await hostPlane();
  }
  const watch = watchRules(ctx);

  const create = async (presetId: string): Promise<Agent> => {
    const handle = await ctx.agents.create({
      sessionId: SessionId(
        `preset-plane-${presetId}-${String(Date.now())}-${String(Math.random())}`,
      ),
      meta: { cwd: workspace },
      setup: async (agentCtx: Context) => {
        await ctx.agentPresets.mount(agentCtx, presetId);
      },
    });
    return handle.agent;
  };
  return { ctx, create, watch };
}

/** 走真实通道：先 assemble（通道在那里收降级 section），再让 pre-step 注入。 */
async function preStep(ctx: Context, agent: Agent): Promise<UserMessage[]> {
  const input = [prompt("任务")];
  await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    { messages: input, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: "enter" as const, messages: input }),
  );
  return decision.kind === "enter" ? decision.messages : [];
}

describe.each([
  { order: "host 平面先装" as const, hostFirst: true },
  { order: "preset 先装" as const, hostFirst: false },
])("preset 平面的边界（$order）", ({ hostFirst }) => {
  const mountBoth = (): ReturnType<typeof mount> => mount({ presets: PRESETS, hostFirst });

  it("工作区指令让位：preset 有那一行时只从上游来一条", async () => {
    const { ctx, create, watch } = await mountBoth();
    const agent = await create("standard");
    await watch.until("agent-instructions:");

    const messages = await preStep(ctx, agent);

    expect(kindsOf(messages, "agent-instructions")).toEqual(["upstream"]);
    expect(bodyOf(messages, "agent-instructions")).toContain(AGENTS_BODY);
  });

  it("skill 面抢面：preset 有 tool-skill 行时工具与目录都是我们的", async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create("standard");

    const messages = await preStep(ctx, agent);

    // 模型看到的 `skill` 工具是本会话注册进 agent 自己那一层的那个（遮蔽 preset 那份）。
    expect(ctx.tools.get("skill", agent)?.description).toBe(OUR_TOOL_DESCRIPTION);
    expect(catalogKinds(messages)).toEqual(["skill-catalog"]);
    expect(textOf(catalogs(messages)[0]!)).toContain(SKILL);
  });

  it("preset 两行都没有（minimal）：两条面都由我们提供", async () => {
    const { ctx, create, watch } = await mountBoth();
    const agent = await create("minimal");
    await watch.until("agent-instructions:");

    const messages = await preStep(ctx, agent);

    expect(kindsOf(messages, "agent-instructions")).toEqual([
      expect.stringMatching(/^agent-instructions:[0-9a-f]{8}:AGENTS\.md$/u),
    ]);
    expect(bodyOf(messages, "agent-instructions")).toContain(AGENTS_BODY);
    expect(ctx.tools.get("skill", agent)?.description).toBe(OUR_TOOL_DESCRIPTION);
    expect(catalogKinds(messages)).toEqual(["skill-catalog"]);
    expect(textOf(catalogs(messages)[0]!)).toContain(SKILL);
  });

  it('surface 上已有我们的目录时，上游不补"没有可用 skill"的空目录', async () => {
    const { ctx, create } = await mountBoth();
    const agent = await create("standard");
    const first = await preStep(ctx, agent);
    // 把这一步注入的条目落进 surface（loop 的做法）：下一步两侧都看得见它们。
    for (const message of first.filter((candidate) => entryIdOf(candidate) !== undefined)) {
      agent.session.append("user/message", message, { surfaceOp: "append" });
    }

    const second = await preStep(ctx, agent);

    // 上游把"任何条目可读的 `skill-catalog` 消息"当成自己的账本：我们的目录要是那个 kind，它这一步会补一条
    // `No skills are currently available through the \`skill\` tool.` 把目录顶掉（它自己的 visibility-loss 语义）。
    // 我们的 kind 是自己的，它两个扫法都看不见，于是彻底闭嘴。
    expect(catalogKinds(second)).toEqual([]);
    expect(second.map(textOf).join("\n")).not.toContain("No skills are currently available");
  });

  it("选 chat 把官方 preset 一起换成 minimal：上游那条工作区指令不再注入", async () => {
    const { ctx, create, watch } = await mount({ presets: PRESETS, hostFirst, modes: MODES });
    const agent = await create("standard");
    await watch.until("agent-instructions:");

    // 模式收口挂在会话上，preset realm 归官方：`select` 之前标准那一套的行还在，上游照旧注入它那条。
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe("standard");
    expect(kindsOf(await preStep(ctx, agent), "agent-instructions")).toEqual(["upstream"]);

    await ctx.sessionModes.select(agent.id, "chat");

    // 选模式 = 换 preset realm：`minimal` 没有上游 `agent-instructions` 那一行，它那条（没有幂等键的）
    // 注入随之消失——`instructions: false` 只收得到我们这一侧，preset 里的行得靠 preset 换掉。
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe("minimal");
    const messages = await preStep(ctx, agent);
    expect(kindsOf(messages, "agent-instructions")).toEqual([]);
    expect(messages.map(textOf).join("\n")).not.toContain(AGENTS_BODY);
  });

  it("让位按会话判：空白窗口里从 minimal 换到 standard 之后，工作区指令交给上游", async () => {
    const { ctx, create, watch } = await mountBoth();
    const agent = await create("minimal");
    await watch.until("agent-instructions:");
    expect(kindsOf(await preStep(ctx, agent), "agent-instructions")).toEqual([
      expect.stringMatching(/^agent-instructions:/u),
    ]);

    await ctx.agentPresets.recompose(agent.ctx, "standard");
    const messages = await preStep(ctx, agent);

    expect(kindsOf(messages, "agent-instructions")).toEqual(["upstream"]);
    // skill 面不受换 preset 影响：工具装在 agent 自己那一层，目录一直是我们那份。
    expect(ctx.tools.get("skill", agent)?.description).toBe(OUR_TOOL_DESCRIPTION);
    expect(catalogKinds(messages)).toEqual(["skill-catalog"]);
  });
});
