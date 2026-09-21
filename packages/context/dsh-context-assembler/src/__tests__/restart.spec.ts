import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import { mountAgentLoopTestDependencies } from "@deepseek-ai/dsh-agent-loop-testkit";
import {
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { SessionId, type Session } from "@deepseek-ai/dsh-session";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map((ctx) => ctx.fiber.dispose()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "block-end", index: 0, block: { type: "text", text: "ok" } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

interface Runtime {
  readonly ctx: Context;
  readonly adapter: RecordingAdapter;
}

/**
 * 一份进程：内存状态全新，只有落盘的东西留下——与重启同形。
 *
 * 存储用 JSONL 而不是 rdb，是因为幂等只看会话日志本身：恢复路径（seed + surface 折叠）
 * 两边一样，结论对部署用的 rdb 恢复同样成立（现场日志也已印证，见设计文档"幂等的判据"）。
 */
async function mountRuntime(root: string): Promise<Runtime> {
  const adapter = new RecordingAdapter();
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
  });
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(JsonlSessionPersistence, { root, compression: "none" });
  await ctx.plugin(SkillRegistry);
  ctx.llm.registerAdapter(["mock"], adapter);
  ctx.on("agent/request", async (_payload, next) => ({
    ...(await next()),
    provider: "mock",
    model: "mock",
  }));
  await ctx.plugin(plugin, {});
  // 一条非 keep section：降级成 `section:tool:bash` 规则块，用来数注入次数。
  ctx.systemPrompt.section({
    name: "tool:bash",
    order: 1000,
    text: "Check the [exit code: N] marker.",
  });
  return { ctx, adapter };
}

async function submit(runtime: Runtime, agent: FollowupCapable, text: string): Promise<void> {
  agent.followup(
    createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }),
  );
  await agent.whenIdle();
  await runtime.ctx.sessions.flush(agent.session);
}

interface FollowupCapable {
  readonly session: Session;
  followup(message: ReturnType<typeof createUserMessage>): void;
  whenIdle(): Promise<void>;
}

/** 每个请求里 `<system-reminder id="…">` 的条数：模型实际看到几条。 */
function remindersPerRequest(adapter: RecordingAdapter): number[] {
  return adapter.requests.map(
    (request) =>
      request.messages.filter((message) =>
        JSON.stringify(message.content).includes("<system-reminder id="),
      ).length,
  );
}

/** 落盘的规则块条数：会话日志里这类 append 事件有几个。 */
function appendedReminders(session: Session): number {
  return session
    .snapshotEvents()
    .filter(
      (event) =>
        event.type === "user/message" &&
        JSON.stringify(event.data).includes('"kind":"context-assembler"'),
    ).length;
}

describe("服务重启后的幂等", () => {
  it("重启后 resume 同一会话：文本没变的规则块不再补发", async () => {
    const root = await mkdtemp(join(tmpdir(), "assembler-restart-"));
    roots.push(root);
    const sessionId = SessionId(`assembler-restart-${Date.now()}`);

    const first = await mountRuntime(root);
    const created = await first.ctx.agentLoop.createAgent(first.ctx, {
      sessionId,
      agentOptions: { provider: "mock", model: "mock" },
    });
    await submit(first, created.agent, "第一问");
    expect(remindersPerRequest(first.adapter)).toEqual([1]);
    expect(appendedReminders(created.agent.session)).toBe(1);
    await created.dispose();
    await first.ctx.fiber.dispose();

    const second = await mountRuntime(root);
    const resumed = await second.ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: "mock", model: "mock" },
    });
    await submit(second, resumed.agent, "第二问");

    // 恢复出来的 surface 里仍有那条规则块，所以这一步不该再补一条。
    expect(remindersPerRequest(second.adapter)).toEqual([1]);
    expect(appendedReminders(resumed.agent.session)).toBe(1);
    await resumed.dispose();
    await second.ctx.fiber.dispose();
  });
});
