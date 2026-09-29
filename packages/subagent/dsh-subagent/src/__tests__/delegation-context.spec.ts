// 判据：真装配（真 `systemPrompt.assemble` + 真子代理）里 `subagent:delegation` 是中文，且不再有上游英文原文——
// continuable 与一次性两条派发路径都要覆盖（它们的调用方都在上游未复制的文件里，见 `../delegation-context.ts`）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { assembleContextFor } from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import * as SubagentSpawn from "@deepseek-ai/dsh-subagent-spawn-in-process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MockAdapter,
  textResponse,
} from "../../../../../vendor/deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts";
import { DELEGATION_CONTEXT_NAME } from "../delegation-context.ts";
import SubagentRuntime from "../index.ts";

const UPSTREAM_SENTENCE = "You are a delegated subagent:";
const CHINESE_SENTENCE = "你是被派发的子代理：";

const contexts = new Set<Context>();
const roots: string[] = [];

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose();
  contexts.clear();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function boot() {
  const ctx = new Context();
  contexts.add(ctx);
  await mountAgentLoopTestDependencies(ctx);
  const root = await mkdtemp(join(tmpdir(), "dsh-delegation-"));
  roots.push(root);
  await ctx.plugin(JsonlSessionPersistence, { root });
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(SubagentRuntime, {} as never);
  await ctx.plugin(SubagentSpawn, { providerName: "spawn" });
  const adapter = new MockAdapter([textResponse("子代理完成")]);
  ctx.llm.registerAdapter(["mock"], adapter);
  const parent = await ctx.agentLoop.create(SessionId("parent"), {
    provider: "mock",
    model: "mock",
  });
  return { ctx, parent };
}

// 子代理自己的那条运行时文本（真装配：`assembleContextFor(child)` 就是 agent loop 用的那一份）。
async function delegationTextOf(ctx: Context, child: Agent): Promise<string | undefined> {
  const assembled = await ctx.systemPrompt.assemble(assembleContextFor(child));
  return assembled.contexts.find((entry) => entry.name === DELEGATION_CONTEXT_NAME)?.text;
}

describe("子代理的委派范围说明", () => {
  it("continuable 子代理：真装配里是中文那条，没有上游英文原文", async () => {
    const { ctx, parent } = await boot();
    const started = await ctx.subagents.startContinuable({
      provider: "spawn",
      label: "写简报",
      request: { prompt: [{ type: "text", text: "写一份简报" }], parent },
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => {
      expect(ctx.agents.get(started.childId)).toBeDefined();
    });
    const child = ctx.agents.get(started.childId);
    if (child === undefined) throw new Error("子代理没有发布");

    const text = await delegationTextOf(ctx, child);
    expect(text).toContain(CHINESE_SENTENCE);
    expect(text).toContain("让派发你的智能体处理。");
    expect(text).not.toContain(UPSTREAM_SENTENCE);
    // 两次装配一致（替换发生在每次装配内，不是"第二次才生效"）。
    expect(await delegationTextOf(ctx, child)).toBe(text);
  });

  it("一次性子代理（`ctx.subagents.start`）也走同一条替换", async () => {
    const { ctx, parent } = await boot();
    const run = await ctx.subagents.start("spawn", {
      label: "一次性",
      prompt: [{ type: "text", text: "干活" }],
      parent,
      signal: new AbortController().signal,
    });
    const child = run.localAgent;
    expect(child).toBeDefined();
    if (child === undefined) return;

    const text = await delegationTextOf(ctx, child);
    expect(text).toContain(CHINESE_SENTENCE);
    expect(text).not.toContain(UPSTREAM_SENTENCE);
    await run.dispose();
  });

  it("父 agent 的装配不出现这条（替换只认子代理）", async () => {
    const { ctx, parent } = await boot();

    expect(await delegationTextOf(ctx, parent)).toBeUndefined();
  });
});
