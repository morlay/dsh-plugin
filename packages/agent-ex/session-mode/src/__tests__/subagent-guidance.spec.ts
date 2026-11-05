// 子代理两处文案的接管：回报指引按会话的 preset 选中文/英文，委派范围说明在装配瀑布里换成中文。
//
// 判据落在两条真 cordis 瀑布的行为上：`agent/pre-step` 与 `system-prompt/assemble`。
// 注：下面那个 `userMessage(content)` 是**本 spec 的局部构造器**（把内容块包成一条消息），
// 不是会话域的 fixtures（`@morlay/dsh-session/testing` 的 `userMessage(seq, id, text)` 是造日志用的）。
import type { Agent, ContentBlock, UserMessage } from "@morlay/dsh-agent/contract";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { SubagentGuidance } from "@morlay/session-mode";
import { provideSubagentGuidance } from "@morlay/session-mode";
import { DELEGATION_CONTEXT_NAME, DELEGATION_CONTEXT_TEXT } from "@morlay/session-mode";

const CHINESE = "你的父智能体 id 是";
const ENGLISH = "Your parent agent id is";

// 装配后的 App：派发要用到 cordis 的事件面（模块增强不在本 program 里，这里窄化一次）。
interface Bus {
  waterfall<R>(event: string, ...args: unknown[]): R;
  reflect: { provide(name: string, value: unknown): void };
}

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

// 只被读会话头的 Agent 替身：两条瀑布只认 `agent.session.header.parentSession`。
function agentStub(parentSession?: string): Agent {
  return {
    id: SessionId(parentSession === undefined ? "parent" : "child"),
    session: {
      header: parentSession === undefined ? {} : { parentSession: SessionId(parentSession) },
    },
    ctx: {},
  } as unknown as Agent;
}

// 上游 `withContinuableReturnGuidance` 的原文（`vendor/.../subagent/subagent/src/continuation-messages.ts`）。
function upstreamGuidance(parentId: string): ContentBlock {
  const encoded = JSON.stringify(parentId);
  return {
    type: "text",
    text:
      `Your parent agent id is ${encoded}. Before you finish, send your result to that agent with ` +
      `send_message({ agent_id: ${encoded}, message: "<self-contained result>" }). The parent shares ` +
      "your workspace but does not automatically receive your transcript, tool output, or reasoning. Send " +
      "earlier messages as well when a finding changes what the parent should do next; sending a message " +
      "does not end your turn.",
  };
}

function userMessage(content: ContentBlock[]): UserMessage {
  return { id: "m1", role: "user", content, source: { kind: "user" } } as unknown as UserMessage;
}

interface Booted {
  readonly bus: Bus;
}

// 本部署只有一个 preset（`config.preset`）：spec 用 `preset` 造「名单内 / 名单外」两种输入，
// 不再装 `agentPresets` 替身——那套是给多 preset 选择面用的。
async function boot(
  options: { readonly presets?: readonly string[]; readonly preset?: string } = {},
): Promise<Booted> {
  const config = {
    ...(options.presets === undefined
      ? {}
      : { localizedReturnGuidancePresets: [...options.presets] }),
    ...(options.preset === undefined ? {} : { preset: options.preset }),
  };
  const app = await bootstrapApplication({
    providers:
      Object.keys(config).length === 0
        ? provideSubagentGuidance()
        : provideSubagentGuidance(configure(SubagentGuidance as never, config as never)),
    timeoutMs: 20_000,
  });
  opened.push(app);
  return { bus: app.ctx as unknown as Bus };
}

// 走一遍 `agent/pre-step`，返回这一步的消息表。
async function preStep(bus: Bus, agent: Agent, messages: UserMessage[]): Promise<UserMessage[]> {
  const decision = await bus.waterfall<Promise<{ kind: "enter"; messages: UserMessage[] }>>(
    "agent/pre-step",
    { agent, messages, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: "enter", messages }),
  );
  return decision.messages;
}

// 走一遍 `system-prompt/assemble`，返回这次装配的上下文表。
async function assemble(
  bus: Bus,
  agent: Agent,
  contexts: { readonly name: string; readonly text: string }[],
): Promise<{ readonly name: string; readonly text: string }[]> {
  const presentation = { sections: [], contexts, variables: {} };
  const result = await bus.waterfall<
    Promise<{ contexts: { readonly name: string; readonly text: string }[] }>
  >("system-prompt/assemble", presentation, { agent }, () => Promise.resolve(presentation));
  return result.contexts;
}

function textsOf(messages: readonly UserMessage[]): string[] {
  return messages.flatMap((message) =>
    message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])),
  );
}

describe("continuable 子代理的回报指引", () => {
  it("没配名单（默认）：任意会话都用中文指引，任务本身原样留着", async () => {
    const { bus } = await boot();
    const messages = [
      userMessage([{ type: "text", text: "写一份简报" }, upstreamGuidance("parent")]),
    ];

    const texts = textsOf(await preStep(bus, agentStub("parent"), messages));

    expect(texts.some((text) => text.includes(CHINESE))).toBe(true);
    expect(texts.some((text) => text.includes(ENGLISH))).toBe(false);
    expect(texts.some((text) => text.includes("写一份简报"))).toBe(true);
  });

  it("配了名单：名单里的 preset 用中文", async () => {
    const { bus } = await boot({ presets: ["mode-switch"], preset: "mode-switch" });
    const texts = textsOf(
      await preStep(bus, agentStub("parent"), [userMessage([upstreamGuidance("parent")])]),
    );

    expect(texts.some((text) => text.includes(CHINESE))).toBe(true);
    expect(texts.some((text) => text.includes(ENGLISH))).toBe(false);
  });

  it("配了名单时名单外的 preset 保持上游英文（限制是显式选择）", async () => {
    const { bus } = await boot({ presets: ["mode-switch"], preset: "standard" });
    const texts = textsOf(
      await preStep(bus, agentStub("parent"), [userMessage([upstreamGuidance("parent")])]),
    );

    expect(texts.some((text) => text.includes(ENGLISH))).toBe(true);
    expect(texts.some((text) => text.includes(CHINESE))).toBe(false);
  });

  it("判定跟派发方（父会话）的 preset 走，不看子代理自己那份", async () => {
    // 本部署的 preset 写死在 config 上（`preset`）：任何 agent 的 ctx 都不参与判定，
    // 判定只认部署那一个——所以这条用例的装配是「部署 preset 在名单里」。
    const { bus } = await boot({ presets: ["mode-switch"], preset: "mode-switch" });
    const child = agentStub("parent");
    (child as unknown as { ctx: object }).ctx = {};

    const texts = textsOf(await preStep(bus, child, [userMessage([upstreamGuidance("parent")])]));

    expect(texts.some((text) => text.includes(CHINESE))).toBe(true);
  });

  it("不是回报指引的消息原样留着（同一个数组回来）", async () => {
    const { bus } = await boot();
    const messages = [userMessage([{ type: "text", text: "普通消息" }])];

    expect(await preStep(bus, agentStub("parent"), messages)).toBe(messages);
  });
});

describe("子代理的委派范围说明", () => {
  const UPSTREAM =
    "You are a delegated subagent: your permission scope was fixed when you were started.";

  it("子代理的装配里换成中文那条，别的上下文原样", async () => {
    const { bus } = await boot();
    const contexts = [
      { name: DELEGATION_CONTEXT_NAME, text: UPSTREAM },
      { name: "context:file-reference", text: "以 @ 开头的词是用户显式引用的工作区路径。" },
    ];

    const result = await assemble(bus, agentStub("parent"), contexts);

    const delegation = result.find((entry) => entry.name === DELEGATION_CONTEXT_NAME);
    expect(delegation?.text).toBe(DELEGATION_CONTEXT_TEXT);
    expect(result[1]).toBe(contexts[1]);
  });

  it("父 agent 的装配不动（这条本来只对子代理注册）", async () => {
    const { bus } = await boot();
    const contexts = [{ name: DELEGATION_CONTEXT_NAME, text: UPSTREAM }];

    expect(await assemble(bus, agentStub(), contexts)).toBe(contexts);
  });
});
