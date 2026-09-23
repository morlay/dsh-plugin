import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { agentEvents, assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import { SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import * as SkillFileSystem from "@deepseek-ai/dsh-skill-filesystem";
import * as ContextAssembler from "../../assembler/index.ts";
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

/**
 * 项目根 + 用户目录各放几个 skill，然后由 **preset 层** 的 `skill-filesystem` 行发现它们。
 *
 * 这正是部署的形状：host 层的同名行被 web app 的 bundle patch 禁用了（本地发现归 preset），
 * 所以读目录时带不带作用域、带不带 cwd 决定了看不看得见它们。
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
  await ctx.plugin(plugin);

  const key = { preset: "standard" };
  const standing = createScope(ctx, key);
  await standing.ctx.plugin(SkillFileSystem, {
    dshHome: join(root, "dsh-home"),
    agentsHome: join(root, "agents-home"),
    watch: false,
  });

  const agent = await harness.create(
    SessionId(`skill-catalog-${Date.now()}-${Math.random()}`),
    {},
    { cwd: root },
  );
  bindScopeParent(scopeOf(agent.ctx)!, key);
  return { ctx, agent };
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
    // 对外身份沿用上游 kind：客户端标签与非模型消费者按它认领这条目录，`entries` 就是发布的那份清单。
    expect(catalog.source.kind).toBe("skill-catalog");
    const entries = (catalog.source as { entries?: readonly { name: string }[] }).entries ?? [];
    expect(entries.map((entry) => entry.name)).toEqual(["project-skill", "user-skill"]);
    expect(body).toContain("project-skill");
    expect(body).toContain("user-skill");
    expect(body).not.toContain("project-hidden");

    await rm(root, { recursive: true, force: true });
  });
});
