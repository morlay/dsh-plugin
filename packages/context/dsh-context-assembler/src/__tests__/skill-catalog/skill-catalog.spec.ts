import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { agentEvents, assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { ToolCallId, createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import { SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import * as SkillFileSystem from "@deepseek-ai/dsh-skill-filesystem";
import { defineTool } from "@deepseek-ai/dsh-tools";
import * as ContextAssembler from "../../assembler/index.ts";
import * as SessionToolScope from "../../scope/index.ts";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../../skill-catalog/index.ts";

/** 通道注入的条目：幂等键在 source 的 `id` 上（kind 会随注入方声明而不同）。 */
function entryIdOf(message: { readonly source: unknown }): string | undefined {
  const id = (message.source as { readonly id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

/** 一份 SKILL.md：`extra` 用来加 frontmatter 字段（例如 `disable-model-invocation`）。 */
function skillFile(name: string, description: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${name} 的正文。\n`;
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

/**
 * 项目根 + 用户目录各放几个 skill，然后由 **preset 层** 的 `skill-filesystem` 行发现它们。
 *
 * 这正是部署的形状：host 层的同名行被 web app 的 bundle patch 禁用了（本地发现归 preset），
 * 所以读目录时带不带作用域、带不带 cwd 决定了看不看得见它们。收口那一行（`scope`）也在，
 * 用来验"白名单把 `skill` 挡在模型目录外"。
 */
async function mount(root: string) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
  });
  const harness = await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(ContextAssembler);
  await ctx.plugin(SessionToolScope);
  // host 平面的工具行（与 `dsh.profile.bundles` 列出 toolkit 时的形状一致）：白名单里的那一件。
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        inner.tools.register(fixtureTool("web_search"));
      },
      { inject: ["tools"] },
    ),
  );
  const fiber = await ctx.plugin(plugin);

  const key = { preset: "standard" };
  const standing = createScope(ctx, key);
  await standing.ctx.plugin(SkillFileSystem, {
    dshHome: join(root, "dsh-home"),
    agentsHome: join(root, "agents-home"),
    watch: false,
  });

  const agent = await harness.create(
    SessionId(`skill-catalog-${Date.now()}-${String(Math.random())}`),
    {},
    { cwd: root },
  );
  bindScopeParent(scopeOf(agent.ctx)!, key);
  return { ctx, agent, fiber };
}

/** 走真实 pre-step 通道注入一次目录，返回那条消息（`source` 的 kind / entries 也在它上面）。 */
async function catalogInjection(ctx: Context, agent: Agent): Promise<UserMessage | undefined> {
  await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const messages: UserMessage[] = [
    createUserMessage({ content: [{ type: "text", text: "任务" }], source: { kind: "user" } }),
  ];
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    { messages, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: "enter" as const, messages }),
  );
  const injected = decision.kind === "enter" ? decision.messages : [];
  return injected.find((message) => entryIdOf(message) === "skill-catalog");
}

function messageText(message: UserMessage | undefined): string {
  const [block] = message?.content ?? [];
  return block?.type === "text" ? block.text : "";
}

async function visibleToolNames(ctx: Context, agent: Agent): Promise<string[]> {
  return (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(
    (tool) => tool.name,
  );
}

async function callTool(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>) {
  return await ctx.tools.execute({
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  });
}

/** 一个带项目 skill 的工作区（`.git` 让它成为项目根）。 */
async function workspace(withProjectSkill: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skill-catalog-"));
  await writeFile(join(root, ".git"), "");
  if (withProjectSkill) {
    await mkdir(join(root, ".agents", "skills", "project-skill"), { recursive: true });
    await writeFile(
      join(root, ".agents", "skills", "project-skill", "SKILL.md"),
      skillFile("project-skill", "项目根的 skill"),
    );
  }
  return root;
}

describe("技能目录", () => {
  it("列出来自 ~/.agents/skills 与 {cwd}/.agents/skills 的技能，带 disable-model-invocation 的不列", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-catalog-"));
    await writeFile(join(root, ".git"), "");
    await mkdir(join(root, ".agents", "skills", "project-skill"), { recursive: true });
    await mkdir(join(root, ".agents", "skills", "project-hidden"), { recursive: true });
    await mkdir(join(root, "agents-home", "skills", "user-skill"), { recursive: true });
    await writeFile(
      join(root, ".agents", "skills", "project-skill", "SKILL.md"),
      skillFile("project-skill", "项目根的 skill"),
    );
    await writeFile(
      join(root, ".agents", "skills", "project-hidden", "SKILL.md"),
      skillFile("project-hidden", "只给用户手动的 skill", "disable-model-invocation: true\n"),
    );
    await writeFile(
      join(root, "agents-home", "skills", "user-skill", "SKILL.md"),
      skillFile("user-skill", "用户全局的 skill"),
    );

    const { ctx, agent } = await mount(root);
    const catalog = await catalogInjection(ctx, agent);
    if (catalog === undefined) throw new Error("expected a catalog message");
    const body = messageText(catalog);

    expect(body).toMatch(/^<system-reminder id="skill-catalog">/);
    // kind 是自己的（上游 `tool-skill` 的账本只认它自己的 kind，见 `index.ts` 的 source 注释）；
    // 形态仍是上游认得的 `catalog`，`entries` 就是客户端列条目的那份清单。
    expect(catalog.source.kind).toBe("context-assembler");
    expect((catalog.source as { form?: string }).form).toBe("catalog");
    const entries = (catalog.source as { entries?: readonly { name: string }[] }).entries ?? [];
    expect(entries.map((entry) => entry.name)).toEqual(["project-skill", "user-skill"]);
    expect(body).toContain("project-skill");
    expect(body).toContain("user-skill");
    expect(body).not.toContain("project-hidden");

    await rm(root, { recursive: true, force: true });
  });

  it("模型侧看到的是这个会话注册进去的那个 `skill` 工具", async () => {
    const root = await workspace(true);
    const { ctx, agent } = await mount(root);

    const before = ctx.tools.get("skill", agent);
    expect(before?.description).toBe("按需加载 skill 的完整说明。");

    // 这一行重挂（HMR / 设置面）：上次那份注册随 agent 留在 agent 自己那一层，重装不能再注册一次
    // （同一层重复注册会抛）。重挂之后工具、目录都照旧。
    const again = await mountPluginAgain(ctx);
    expect(ctx.tools.get("skill", agent)).toBe(before);
    expect(messageText(await catalogInjection(ctx, agent))).toContain("project-skill");
    await again.dispose();

    await rm(root, { recursive: true, force: true });
  });

  it("chat 那种会话（白名单没有 `skill`、instructions 关掉）：模型目录里没有它、调用被拒、目录块也不注入", async () => {
    const root = await workspace(true);
    const { ctx, agent } = await mount(root);
    ctx.sessionToolScope.apply(agent, {
      name: "对话模式",
      allowTools: ["web_search"],
      instructions: false,
      runtimeContext: false,
    });

    // 收口是**会话语义**上的（投影 + guard），注册表里那份仍在（它随 agent 收回）。
    expect(ctx.tools.get("skill", agent)?.description).toBe("按需加载 skill 的完整说明。");
    expect(await visibleToolNames(ctx, agent)).toEqual(["web_search"]);
    // guard 在 `apply` 里等 `tools` 激活才注册：先走一步装配。
    await ctx.systemPrompt.assemble(assembleContextFor(agent));
    const denied = await callTool(ctx, agent, "skill", { name: "project-skill" });
    expect(denied.error).toBeDefined();

    // `instructions: false` 管的是规则块：技能目录这一条不注入。
    expect(await catalogInjection(ctx, agent)).toBeUndefined();

    await rm(root, { recursive: true, force: true });
  });
});

/** 再装一行 `skill-catalog`（同一个 ctx，模拟这一行的重挂）。 */
async function mountPluginAgain(ctx: Context): Promise<{ dispose(): Promise<void> }> {
  return await ctx.plugin(plugin);
}
