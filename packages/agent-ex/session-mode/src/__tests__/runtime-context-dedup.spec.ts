// 注入的幂等：同一份运行时上下文只送达一次。
//
// 上游的判据是「最近一条保留的注入记录与本次相同就不重发」，它的监听挂在 **agent scope** 上，
// 而 `session/event` 由会话存储（根 scope 上的行）发出——cordis 的事件只向上流，agent scope 收不到，
// 那条判据于是永远不成立：每个请求都追加一整条同样的 `<system-reminder>`（会话里越堆越多）。
//
// 修法在 `@morlay/dsh-agent-loop` 的 `AgentSessionEvents`（把会话事件定向补发到 agent scope），
// 取舍与前提见 `packages/agent/.agents/designs/20261119-会话事件补发到agent-scope.md`。
// 本文件钉三件事：**没变不重发**、**变了要发**、**补发不双触发**。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from "@morlay/dsh-agent/contract";
import { LlmAdapter } from "@morlay/dsh-agent/server";
import { SessionId } from "@morlay/dsh-session/contract";
import { JsonlSessionPersistence } from "@morlay/dsh-session-persistence";
import { afterEach, describe, expect, it } from "vitest";
import type { TestContext } from "./support/context.ts";
import { mountSessionModeApp } from "./support/mount-app.ts";

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "block-end", index: 0, block: { type: "text", text: "ok" } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

interface Followable {
  followup(message: unknown): void;
  whenIdle(): Promise<void>;
  session: {
    readonly seq: number;
    snapshotEvents(): readonly { type: string; data?: unknown }[];
  };
}

interface Runtime {
  readonly adapter: RecordingAdapter;
  readonly ctx: TestContext;
  readonly agent: Followable;
  /** 换掉运行时上下文里那条策略文本（模拟「内容变了」）。 */
  setPolicy(text: string): void;
}

/** 每步请求里模型看到的运行时上下文条数（历史累积，所以「没变」应当保持不变）。 */
function snapshotCounts(adapter: RecordingAdapter): number[] {
  return adapter.requests.map(
    (request) =>
      request.messages.filter(
        (message) => (message as { source?: { kind?: string } }).source?.kind === "runtime-context",
      ).length,
  );
}

/** 会话日志里落库的运行时上下文条数。 */
function appended(runtime: Runtime): number {
  return runtime.agent.session
    .snapshotEvents()
    .filter(
      (event) =>
        event.type === "user/message" &&
        (event.data as { source?: { kind?: string } } | undefined)?.source?.kind ===
          "runtime-context",
    ).length;
}

const apps: Awaited<ReturnType<typeof mountSessionModeApp>>["app"][] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.dispose()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** 起一份两步对话的运行时（真 cordis 根 ctx + 真会话落盘 + 一条运行时上下文）。 */
async function mountRuntime(): Promise<Runtime> {
  const root = await mkdtemp(join(tmpdir(), "runtime-context-dedup-"));
  roots.push(root);
  const adapter = new RecordingAdapter();
  const { app, ctx } = await mountSessionModeApp({ modes: false, guidance: false });
  apps.push(app);
  await ctx.plugin(JsonlSessionPersistence as never, { root, compression: "none" } as never);
  const llm = ctx.get("llm") as {
    registerAdapter(providers: readonly string[], value: unknown): void;
  };
  llm.registerAdapter(["mock"], adapter);
  ctx.on("agent/request", async (_payload: unknown, next: () => Promise<unknown>) => ({
    ...((await next()) as Record<string, unknown>),
    provider: "mock",
    model: "mock",
  }));
  let policy = "Mode: workspace-write.";
  (ctx as TestContext).systemPrompt.context({
    name: "sandbox:policy",
    order: 10,
    text: () => policy,
  });
  const created = await ctx.agentLoop.createAgent(ctx, {
    sessionId: SessionId(`runtime-context-dedup-${String(Date.now())}`),
    agentOptions: { provider: "mock", model: "mock" },
  });
  return {
    adapter,
    ctx: ctx as TestContext,
    agent: created.agent,
    setPolicy: (text) => {
      policy = text;
    },
  };
}

/** 交一轮问题并等它跑完。 */
async function submit(runtime: Runtime, text: string): Promise<void> {
  runtime.agent.followup(
    createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }),
  );
  await runtime.agent.whenIdle();
}

describe("运行时上下文的注入幂等", () => {
  it("没变就不重发：每步请求里只有一条，日志里也只落一条", async () => {
    const runtime = await mountRuntime();
    await submit(runtime, "第一问");
    await submit(runtime, "第二问");
    // 第二份快照的引导语会换成「覆盖更早版本」，那是文案差异，不是内容差异。
    expect(snapshotCounts(runtime.adapter)).toEqual([1, 1]);
    expect(appended(runtime)).toBe(1);
  }, 60_000);

  it("补发只到 agent scope：根上的监听器不会多收一遍（否则持久化会写两遍）", async () => {
    const runtime = await mountRuntime();
    await submit(runtime, "第一问");
    let received = 0;
    runtime.ctx.on("session/event", () => {
      received += 1;
    });
    const before = runtime.agent.session.seq;
    await submit(runtime, "第二问");
    // 这一轮真实 append 了多少条事件，根上就该收到多少条——多出来的那条就是双触发。
    expect(received).toBe(runtime.agent.session.seq - before);
  }, 60_000);

  it("内容变了要发新的一条（不把变化也吃掉）", async () => {
    const runtime = await mountRuntime();
    await submit(runtime, "第一问");
    runtime.setPolicy("Mode: read-only.");
    await submit(runtime, "第二问");
    await submit(runtime, "第三问");
    expect(snapshotCounts(runtime.adapter)).toEqual([1, 2, 2]);
    expect(appended(runtime)).toBe(2);
  }, 60_000);
});
