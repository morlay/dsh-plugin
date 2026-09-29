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

// 运行期证据：continuable 子代理首条任务后面的回报指引**按会话的 preset 选**——名单（本行配置）命中就是
// 中文，其余（含官方 shipped preset、没有 preset 的会话）是上游英文那套。名单与 preset 身份是两个输入：
// 名单走本行配置，身份走 `agentPresets` 服务（这里用替身）。
async function boot(
  options: { readonly presets?: readonly string[]; readonly composedPreset?: string } = {},
) {
  const ctx = new Context();
  contexts.add(ctx);
  await mountAgentLoopTestDependencies(ctx);
  const root = await mkdtemp(join(tmpdir(), "dsh-subagent-guidance-"));
  roots.push(root);
  await ctx.plugin(JsonlSessionPersistence, { root });
  await ctx.plugin(AgentLoop, { agents: [] });
  if (options.composedPreset !== undefined) {
    ctx.provide("agentPresets", {
      composedPreset: () => options.composedPreset,
      // 子代理继承父 preset 那条路（registry 的另一半接口）；本用例只关心文案，给个"父没挂 preset"的回答。
      composeFrom: () => undefined,
    } as never);
  }
  await ctx.plugin(
    SubagentRuntime,
    (options.presets === undefined
      ? {}
      : { localizedReturnGuidancePresets: [...options.presets] }) as never,
  );
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

// 一次 continuable 派发之后，模型侧看到的所有文本。
async function textsAfterDelegation(booted: Awaited<ReturnType<typeof boot>>): Promise<string[]> {
  const { ctx, parent, adapter } = booted;
  const started = await ctx.subagents.startContinuable({
    provider: "spawn",
    label: "写简报",
    request: { prompt: [{ type: "text", text: "写一份简报" }], parent },
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => {
    expect(visibleTexts(adapter).length).toBeGreaterThan(0);
  });
  expect(started.childId).toBeDefined();
  return visibleTexts(adapter);
}

describe("continuable 子代理的回报指引", () => {
  it("会话挂着名单里的 preset 时，模型看到的是中文指引", async () => {
    const texts = await textsAfterDelegation(
      await boot({ presets: ["mode-switch"], composedPreset: "mode-switch" }),
    );

    expect(texts.some((text) => text.includes("你的父智能体 id 是"))).toBe(true);
    expect(texts.some((text) => text.includes("Your parent agent id is"))).toBe(false);
  });

  it("名单外的 preset 用上游英文指引（官方 shipped preset 的会话不被换文案）", async () => {
    const texts = await textsAfterDelegation(
      await boot({ presets: ["mode-switch"], composedPreset: "standard" }),
    );

    expect(texts.some((text) => text.includes("Your parent agent id is"))).toBe(true);
    expect(texts.some((text) => text.includes("你的父智能体 id 是"))).toBe(false);
  });

  it("没配名单时一律上游英文（默认不换）", async () => {
    const texts = await textsAfterDelegation(await boot());

    expect(texts.some((text) => text.includes("Your parent agent id is"))).toBe(true);
    expect(texts.some((text) => text.includes("你的父智能体 id 是"))).toBe(false);
  });
});
