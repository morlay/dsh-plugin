import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import * as SubagentSpawn from "@deepseek-ai/dsh-subagent-spawn-in-process";
import * as toolSubagentControl from "@deepseek-ai/dsh-tool-subagent-control";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MockAdapter,
  textResponse,
} from "../../../../../vendor/deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts";
import SubagentRuntime from "../index.ts";

const contexts = new Set<Context>();
const roots: string[] = [];

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose();
  contexts.clear();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/**
 * 运行期证据：`send_message` 打上相邻 agent 标记时（上游 control 行在场），
 * continuable 子代理首条任务后面的回报指引来自本包——模型可见的请求里是中文，没有上游英文那句。
 */
async function boot() {
  const ctx = new Context();
  contexts.add(ctx);
  await mountAgentLoopTestDependencies(ctx);
  const root = await mkdtemp(join(tmpdir(), "dsh-subagent-guidance-"));
  roots.push(root);
  await ctx.plugin(JsonlSessionPersistence, { root });
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(SubagentRuntime);
  await ctx.plugin(SubagentSpawn, { providerName: "spawn" });
  await ctx.plugin(toolSubagentControl);
  const adapter = new MockAdapter([textResponse("子代理完成")]);
  ctx.llm.registerAdapter(["mock"], adapter);
  const parent = await ctx.agentLoop.create(SessionId("parent"), {
    provider: "mock",
    model: "mock",
  });
  return { ctx, parent, adapter };
}

function visibleTexts(adapter: MockAdapter): string[] {
  return adapter.requests.flatMap((request) =>
    request.messages.flatMap((message) =>
      message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])),
    ),
  );
}

describe("continuable 子代理的回报指引", () => {
  it("模型看到的是中文指引，不是上游英文", async () => {
    const { ctx, parent, adapter } = await boot();

    const started = await ctx.subagents.startContinuable({
      provider: "spawn",
      label: "写简报",
      request: { prompt: [{ type: "text", text: "写一份简报" }], parent },
      signal: new AbortController().signal,
    });

    await vi.waitFor(() => {
      expect(visibleTexts(adapter).length).toBeGreaterThan(0);
    });
    const texts = visibleTexts(adapter);

    expect(started.childId).toBeDefined();
    expect(texts.some((text) => text.includes("你的父代理 id 是"))).toBe(true);
    expect(texts.some((text) => text.includes("Your parent agent id is"))).toBe(false);
  });
});
