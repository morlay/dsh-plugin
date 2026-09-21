import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { agentEvents, assembleContextFor } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import { SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import * as ContextAssembler from "@morlay/dsh-context-assembler";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

const AGENTS = "# 规则\n\n先读 AGENTS.md。";

async function mount(root: string) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
  });
  const harness = await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(ContextAssembler);
  await ctx.plugin(plugin, { dshHome: join(root, "home") });

  const key = { preset: "standard" };
  createScope(ctx, key);
  const agent = await harness.create(
    SessionId(`workspace-${Date.now()}-${Math.random()}`),
    {},
    { cwd: root },
  );
  bindScopeParent(scopeOf(agent.ctx)!, key);
  return { ctx, agent };
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
}

function textOf(message: UserMessage): string {
  const [block] = message.content;
  return block?.type === "text" ? block.text : "";
}

function idOf(message: UserMessage): string | undefined {
  return message.source.kind === "context-assembler" ? message.source.id : undefined;
}

function bodyOf(messages: readonly UserMessage[], id: string): string {
  const message = messages.find((candidate) => idOf(candidate) === id);
  return message === undefined ? "" : textOf(message);
}

/** 走真实通道：先 assemble（通道在那里收降级 section），再让 pre-step 注入。 */
async function preStep(ctx: Context, agent: Parameters<typeof assembleContextFor>[0]) {
  await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    {
      messages: [prompt("任务")],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    },
    async () => ({ kind: "enter" as const, messages: [prompt("任务")] }),
  );
  return decision.kind === "enter" ? decision.messages : [];
}

/** 安装是异步的（要读文件）：轮询到注入出现为止。 */
async function injectedMessages(
  ctx: Context,
  agent: Parameters<typeof assembleContextFor>[0],
): Promise<UserMessage[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = await preStep(ctx, agent);
    if (messages.length > 1) return messages;
    await new Promise((settle) => {
      setTimeout(settle, 5);
    });
  }
  return preStep(ctx, agent);
}

describe("工作区指令", () => {
  it("把项目根的 AGENTS.md 与用户全局 AGENTS.md 各注入一条，id 到文件", async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-"));
    await writeFile(join(root, ".git"), "");
    await writeFile(join(root, "AGENTS.md"), AGENTS);
    await writeFile(join(root, "home", "AGENTS.md"), "").catch(() => undefined);

    const { ctx, agent } = await mount(root);

    const messages = await injectedMessages(ctx, agent);
    expect(messages.map(idOf)).toContain("agent-instructions:AGENTS.md");
    expect(bodyOf(messages, "agent-instructions:AGENTS.md")).toContain("先读 AGENTS.md");
    expect(bodyOf(messages, "agent-instructions:AGENTS.md")).toMatch(
      /^<system-reminder id="agent-instructions:AGENTS\.md">/,
    );

    await rm(root, { recursive: true, force: true });
  });

  it("文件内容变化后重发同 id 的新规则块", async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-"));
    await writeFile(join(root, ".git"), "");
    await writeFile(join(root, "AGENTS.md"), AGENTS);

    const { ctx, agent } = await mount(root);

    const first = await injectedMessages(ctx, agent);
    for (const message of first.filter(
      (candidate) => candidate.source.kind === "context-assembler",
    )) {
      agent.session.append("user/message", message, { surfaceOp: "append" });
    }

    await writeFile(join(root, "AGENTS.md"), `${AGENTS}\n新增一条。`);

    const second = await injectedMessages(ctx, agent);
    expect(bodyOf(second, "agent-instructions:AGENTS.md")).toContain("新增一条");

    await rm(root, { recursive: true, force: true });
  });
});
