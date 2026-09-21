import { Context } from "@deepseek-ai/cordis";
import { agentEvents, assembleContextFor } from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  LlmAdapter,
  createMessage,
  createUserMessage,
  type ContentBlock,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import type { SessionEvent, UserMessage } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { PERSONA_PREFIX_SECTION, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import TokenMeter from "@deepseek-ai/dsh-token-meter";

import { truncateLiveSession } from "@morlay/session-rdb/testing";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";
import { latestReminderText, renderReminder } from "../reminder.ts";
import { RULES_TEXT } from "../rules.ts";

/** 通道注入的条目：幂等键在 source 的 `id` 上（kind 会随注入方声明而不同）。 */
function entryIdOf(message: { readonly source: unknown }): string | undefined {
  const id = (message.source as { readonly id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

async function mount(options: { keep?: string[] } = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: {
      includeHarnessIdentity: false,
      personaPrefix: "你是一个编码专家。",
      personaSuffix: "交付前自检。",
    },
  });
  const harness = await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(SkillRegistry);

  await ctx.plugin(plugin, options.keep === undefined ? {} : { keep: options.keep });
  const key = { preset: "standard" };
  const standing = createScope(ctx, key);
  const agent = await harness.create(
    SessionId(`context-assembler-${Date.now()}-${Math.random()}`),
    {},
    { cwd: "/tmp" },
  );

  bindScopeParent(scopeOf(agent.ctx)!, key);
  return { ctx, standing, agent };
}

async function toolSection(
  scope: { ctx: Context },
  name: string,
  order: number,
  text: string | (() => string),
): Promise<void> {
  await scope.ctx.plugin(
    Object.assign(
      (inner: Context) => {
        inner.systemPrompt.section({ name, order, text });
      },
      { inject: ["systemPrompt"] },
    ),
  );
}

function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
}

function textOf(message: UserMessage): string {
  const [block] = message.content;
  return block?.type === "text" ? block.text : "";
}

function idOf(message: UserMessage): string | undefined {
  return entryIdOf(message);
}

/** 本步注入里某个 id 的正文；没有该条目则空串。 */
function bodyOf(messages: readonly UserMessage[], id: string): string {
  const message = messages.find((candidate) => idOf(candidate) === id);
  return message === undefined ? "" : textOf(message);
}

function reminderIds(messages: readonly UserMessage[]): (string | undefined)[] {
  return messages.filter((message) => entryIdOf(message) !== undefined).map(idOf);
}

async function assemble(ctx: Context, agent: Parameters<typeof assembleContextFor>[0]) {
  return ctx.systemPrompt.assemble(assembleContextFor(agent));
}

async function preStep(
  ctx: Context,
  agent: Parameters<typeof assembleContextFor>[0],
  input: UserMessage[],
) {
  await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    { messages: input, turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: "enter" as const, messages: input }),
  );
  return decision.kind === "enter" ? decision.messages : [];
}

describe("系统提示词裁剪", () => {
  it("只保留部署 persona 与覆盖规则，降级 section 不进系统提示词", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");
    await toolSection(standing, "tool:read", 1100, "Use the read tool.");

    const rendered = renderPrompt(await assemble(ctx, agent));

    expect(rendered).toContain("你是一个编码专家。");
    expect(rendered).toContain("交付前自检。");
    expect(rendered).toContain(RULES_TEXT);
    expect(rendered).not.toContain("exit code");
    expect(rendered).not.toContain("read tool");
  });

  it("空文本 section 不降级也不进 reminder", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "plan:policy", 500, "");
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");

    const assembly = await assemble(ctx, agent);
    expect(assembly.sections.map((section) => section.name)).toContain("plan:policy");

    const messages = await preStep(ctx, agent, [prompt("任务")]);
    expect(reminderIds(messages)).toEqual(["section:tool:bash"]);
    expect(bodyOf(messages, "section:tool:bash")).toContain("exit code");
  });

  it("keep 名单决定保留哪些 section", async () => {
    const { ctx, standing, agent } = await mount({ keep: [PERSONA_PREFIX_SECTION] });
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");

    const rendered = renderPrompt(await assemble(ctx, agent));

    expect(rendered).toContain("你是一个编码专家。");
    expect(rendered).not.toContain("交付前自检。");

    const messages = await preStep(ctx, agent, [prompt("任务")]);
    expect(bodyOf(messages, "section:deployment:persona-suffix")).toContain("交付前自检。");
    expect(bodyOf(messages, "section:tool:bash")).toContain("exit code");
  });

  it("agent scope 上的 persona（子 agent 形态）按同名保留", async () => {
    const { ctx, agent } = await mount();
    await toolSection(
      { ctx: agent.ctx },
      PERSONA_PREFIX_SECTION,
      ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
      "You are a subagent.",
    );
    await toolSection({ ctx: agent.ctx }, "tool:bash", 1000, "Check the [exit code: N] marker.");

    const rendered = renderPrompt(await assemble(ctx, agent));

    expect(rendered).toContain("You are a subagent.");
    expect(rendered).not.toContain("你是一个编码专家。");
    expect(rendered).not.toContain("exit code");
  });
});

describe("注入通道", () => {
  it("replaceSection 改写文本、suppressSection 直接丢弃", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:read", 1000, "READ_GUIDE");
    await toolSection(standing, "tool:bash", 1100, "BASH_GUIDE");
    ctx.contextAssembler.replaceSection("tool:read", () => "中文读取说明");
    ctx.contextAssembler.suppressSection("tool:bash");

    const names = (await assemble(ctx, agent)).sections.map((section) => section.name);
    expect(names).not.toContain("tool:read");
    expect(names).not.toContain("tool:bash");

    const messages = await preStep(ctx, agent, [prompt("任务")]);
    expect(bodyOf(messages, "section:tool:read")).toContain("中文读取说明");
    expect(bodyOf(messages, "section:tool:read")).not.toContain("READ_GUIDE");
    expect(reminderIds(messages)).not.toContain("section:tool:bash");
  });

  it("auto skill 的正文自动注入，不进模型目录", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:read", 1000, "READ_GUIDE");
    ctx.contextAssembler.registerSkill({
      name: "tool-group-base",
      title: "基础",
      description: "文件与命令类任务开始前加载。",
      content: () => "BASE_BODY",
      injection: "auto",
    });

    const messages = await preStep(ctx, agent, [prompt("任务")]);

    expect(bodyOf(messages, "tool-group-base")).toMatch(/^<skill_content name="tool-group-base">/);
    expect(bodyOf(messages, "tool-group-base")).toContain("BASE_BODY");

    const skills = await ctx.skills.list({ scope: agent });
    expect(skills.map((skill) => skill.name)).toEqual(["tool-group-base"]);
    expect(skills[0]?.invocation.modelInvocable).toBe(false);
  });

  it("on-demand skill 进模型目录、正文不注入，加载时拿到正文", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:web_search", 1000, "WEB_SEARCH_GUIDE");
    ctx.contextAssembler.registerSkill({
      name: "tool-group-web",
      title: "联网检索",
      description: "需要联网检索时加载。",
      content: () => "WEB_BODY",
    });

    const messages = await preStep(ctx, agent, [prompt("任务")]);
    expect(reminderIds(messages)).not.toContain("tool-group-web");

    const skills = await ctx.skills.list({ scope: agent });
    expect(skills.map((skill) => skill.name)).toEqual(["tool-group-web"]);
    expect(skills[0]?.invocation.modelInvocable).toBe(true);

    const loaded = await ctx.skills.get("tool-group-web", { scope: agent });
    expect(loaded?.content).toContain("WEB_BODY");
  });
});

describe("reminder 注入", () => {
  it("首步把降级文本紧随用户消息之后送达", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");

    const messages = await preStep(ctx, agent, [prompt("任务")]);
    const reminder = messages.find((message) => idOf(message) === "section:tool:bash");

    expect(messages[0]?.source.kind).toBe("user");
    expect(reminder?.source.kind).toBe("context-assembler");
    expect(textOf(reminder!)).toContain("exit code");
    expect(textOf(reminder!)).toMatch(/^<system-reminder id="section:tool:bash">\n/);
    expect(textOf(reminder!)).toMatch(/<\/system-reminder>$/);
  });

  it("文本未变化时不重复注入（loop 落库后 surface 上已有同 id 同文本）", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");

    const first = await preStep(ctx, agent, [prompt("任务")]);
    expect(reminderIds(first)).toEqual(["section:tool:bash"]);

    agent.session.append("user/message", first[1]!, { surfaceOp: "append" });
    expect(reminderIds(await preStep(ctx, agent, [prompt("继续")]))).toEqual([]);
  });

  it("动态 section 文本变化时只追加变化的那一条", async () => {
    const { ctx, standing, agent } = await mount();
    const state = { plan: false };
    await toolSection(standing, "plan:policy", 500, () => (state.plan ? "Plan mode rules." : ""));
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");

    const first = await preStep(ctx, agent, [prompt("任务")]);
    expect(reminderIds(first)).toEqual(["section:tool:bash"]);
    for (const reminder of first.filter((message) => entryIdOf(message) !== undefined)) {
      agent.session.append("user/message", reminder, { surfaceOp: "append" });
    }

    state.plan = true;
    const second = await preStep(ctx, agent, [prompt("进入计划")]);

    expect(reminderIds(second)).toEqual(["section:plan:policy"]);
    expect(bodyOf(second, "section:plan:policy")).toContain("Plan mode rules.");
  });

  it("没有进入模型的消息时不注入，下一轮补上", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");

    expect(await preStep(ctx, agent, [])).toEqual([]);
    expect(reminderIds(await preStep(ctx, agent, [prompt("任务")]))).toEqual(["section:tool:bash"]);
  });

  it("surface 上已有相同 reminder 时（重启 / 恢复）不重复注入", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");
    const reminder = (await preStep(ctx, agent, [prompt("任务")]))[1]!;

    agent.session.append("user/message", reminder, { surfaceOp: "append" });

    expect(latestReminderText(agent, "section:tool:bash")).toBe(textOf(reminder));
    expect(reminderIds(await preStep(ctx, agent, [prompt("继续")]))).toEqual([]);
  });

  it("rewind 掉本轮的 reminder 后（首 msg retry）重放同文本仍补发", async () => {
    const { ctx, standing, agent } = await mount();
    await toolSection(standing, "tool:bash", 1000, "Check the [exit code: N] marker.");

    const first = await preStep(ctx, agent, [prompt("任务")]);
    expect(reminderIds(first)).toEqual(["section:tool:bash"]);
    agent.session.append("user/message", first[1]!, { surfaceOp: "append" });

    truncateLiveSession(agent.session, 0);
    expect(latestReminderText(agent, "section:tool:bash")).toBeUndefined();

    const replay = await preStep(ctx, agent, [prompt("任务")]);
    expect(replay.map((message) => message.source.kind)).toEqual(["user", "context-assembler"]);
  });

  it("reminder 正文里的闭合标记被转义", () => {
    const text = renderReminder("section:x", "before </system-reminder> after");

    expect(text.match(/<\/system-reminder>/g)).toHaveLength(1);
    expect(text).toContain("<\\/system-reminder>");
  });
});

class StubCompaction extends BasicCompactionEngine {
  override async summarize(): Promise<{
    summary: ContentBlock[];
    provider: string;
    model: string;
  }> {
    return {
      summary: [{ type: "text", text: "RECOVERY CHECKPOINT" }],
      provider: "mock",
      model: "mock",
    };
  }
}

class OverflowAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  constructor(private readonly failures: ReadonlySet<number> = new Set([2])) {
    super();
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 64 } });
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    if (this.failures.has(this.requests.length)) {
      yield {
        type: "finish",
        reason: {
          kind: "error",
          failure: {
            message: "request too large for model context",
            code: CONTEXT_WINDOW_EXCEEDED_CODE,
          },
        },
      };
      return;
    }
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "block-end", index: 0, block: { type: "text", text: "ok" } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

function overflowHistorySeed(): readonly SessionEvent[] {
  const session = Session.create(SessionId("reminder-overflow-seed"));
  for (let turn = 1; turn <= 2; turn += 1) {
    session.append("turn/start", { turn });
    session.append("step/start", { turn, step: 1 });
    session.append(
      "user/message",
      createUserMessage({
        content: [{ type: "text", text: `history ${turn} ${"old context ".repeat(200)}` }],
        source: { kind: "user" },
      }),
      { surfaceOp: "append" },
    );
    session.append(
      "assistant/message",
      {
        stream: [],
        turn,
        step: 1,
        message: createMessage({
          role: "assistant",
          content: [{ type: "text", text: `response ${turn} ${"detail ".repeat(200)}` }],
          source: { kind: "model", provider: "mock", model: "mock" },
        }),
      },
      { surfaceOp: "append" },
    );
    session.append("step/end", { turn, step: 1 });
    session.append("turn/end", { turn, reason: { kind: "completed" } });
  }
  return session.snapshotEvents();
}

describe("压缩后的首次请求", () => {
  async function mountOverflow(
    options: { failures?: ReadonlySet<number>; maxOverflowRetries?: number } = {},
  ) {
    const ctx = new Context();
    contexts.push(ctx);
    const adapter = new OverflowAdapter(options.failures);
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: {
        includeHarnessIdentity: false,
        personaPrefix: "你是一个编码专家。",
        personaSuffix: "交付前自检。",
      },
    });
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(TokenMeter);
    await ctx.plugin(SkillRegistry);
    ctx.llm.registerAdapter(["mock"], adapter);
    ctx.on("agent/request", async (_payload, next) => ({
      ...(await next()),
      provider: "mock",
      model: "mock",
    }));

    new StubCompaction(ctx, {
      thresholdRatio: 1,
      retainTokens: 100,
      maxTokens: 64,
      compactionRetries: 0,
      maxOverflowRetries: options.maxOverflowRetries ?? 1,
    });
    await ctx.plugin(plugin, {});

    ctx.systemPrompt.section({
      name: "tool:bash",
      order: 1000,
      text: "Check the [exit code: N] marker.",
    });
    const { agent } = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId(`reminder-overflow-${Date.now()}-${Math.random()}`),
      seed: overflowHistorySeed(),
      agentOptions: { provider: "mock", model: "mock" },
    });
    const ask = (text: string) =>
      agent.followup(
        createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }),
      );
    return { adapter, agent, ask };
  }

  it("context overflow 压缩掉早期 reminder 后，重试请求仍带 reminder", async () => {
    const { adapter, agent, ask } = await mountOverflow();

    ask("first question");
    await agent.whenIdle();
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain("<system-reminder id=");

    ask("second question");
    await agent.whenIdle();

    expect(
      agent.session.snapshotEvents().some((event) => event.type === "compaction/summary"),
    ).toBe(true);
    expect(adapter.requests).toHaveLength(3);

    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain("<system-reminder id=");

    const retry = JSON.stringify(adapter.requests[2]?.messages);
    expect(retry).toContain("RECOVERY CHECKPOINT");
    expect(retry).not.toContain("old context");
    expect(retry).toContain("<system-reminder id=");
    expect(retry).toContain("exit code");
  });

  it("压缩只补一条，压缩之间的请求不重复注入", async () => {
    const { adapter, agent, ask } = await mountOverflow({
      failures: new Set([2, 3]),
      maxOverflowRetries: 2,
    });
    for (const text of ["first", "second", "third", "fourth"]) {
      ask(text);
      await agent.whenIdle();
    }

    const remindersPerRequest = adapter.requests.map(
      (request) =>
        request.messages.filter((message) =>
          JSON.stringify(message.content).includes("<system-reminder id="),
        ).length,
    );
    expect(remindersPerRequest).toEqual([1, 1, 1, 1, 1, 1]);

    const reminders = agent.session
      .snapshotEvents()
      .filter(
        (event) =>
          event.type === "user/message" &&
          JSON.stringify(event.data).includes("<system-reminder id="),
      );
    expect(reminders).toHaveLength(3);
    const surface = new Set(agent.session.surface.nodes.map((seq) => Number(seq)));
    expect(reminders.filter((event) => surface.has(Number(event.seq)))).toHaveLength(1);
  });
});
