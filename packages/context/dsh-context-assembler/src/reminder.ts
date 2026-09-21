import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type MessageSource } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-session";

const REMINDER_OPEN = "<system-reminder";
const REMINDER_CLOSE = "</system-reminder>";

/**
 * 覆盖规则在系统提示词里声明一次（见 [`rules.ts`](./rules.ts)），所以每条 reminder 只带 id 与正文，
 * 不再重复解释"最新一条覆盖更早的"。
 */
export const RULES_SECTION = "assembler:rules";

/** 通道自己的条目形态（注入方没声明 source 时的默认）：规则块，幂等键是 id。 */
export interface PromptReminderSource {
  kind: "context-assembler";
  form: "instructions";
  /** 条目 id：同 id 的最新一条取代更早的同 id 条目。本插件早先落库的消息没有它。 */
  id?: string;
}

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "context-assembler": PromptReminderSource;
  }
}

/**
 * 这条消息是不是通道注入的条目——判据是 source 里的幂等键，而不是 kind：接管上游那两面的条目
 * 用上游 kind（`agent-instructions` / `skill-catalog`），幂等必须照样认。
 */
export function promptEntryIdOf(source: MessageSource): string | undefined {
  const id = (source as { readonly id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function escapeFrameBody(body: string): string {
  return body.replaceAll(REMINDER_CLOSE, "<\\/system-reminder>");
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function renderReminder(id: string, body: string): string {
  return `${REMINDER_OPEN} id="${escapeAttr(id)}">\n${escapeFrameBody(body)}\n${REMINDER_CLOSE}`;
}

/**
 * 虚拟 skill（运行时注册、没有资源目录）的正文形态：只有 `<skill_instructions>`，
 * 不渲染上游 `renderSkillContent` 的 `<skill_resources>`（那段对虚拟 skill 是噪音）。
 */
export function renderVirtualSkill(name: string, content: string): string {
  return [
    `<skill_content name="${escapeAttr(name)}">`,
    "<skill_instructions>",
    content,
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

/** 这条消息是不是通道注入的条目（判据是 source 里的幂等键，见 `promptEntryIdOf`）。 */
export function isPromptReminder(message: UserMessage): boolean {
  return promptEntryIdOf(message.source) !== undefined;
}

/** surface 上最近一条该 id 的 reminder 原文（含信封）；没有则 undefined。 */
export function latestReminderText(agent: Agent, id: string): string | undefined {
  for (const seq of agent.session.surface.nodes.toReversed()) {
    const event = agent.session.eventAt(seq);
    if (event?.type !== "user/message") continue;
    if (promptEntryIdOf(event.data.source) !== id) continue;
    const [block] = event.data.content;
    return event.data.content.length === 1 && block?.type === "text" ? block.text : "";
  }
  return undefined;
}

/**
 * 注入一条提醒：`text` 是已渲染好的完整正文（规则块或内容块），`key` 是它的幂等键。
 * `source` 声明这条消息对外的身份——接管上游那两面用上游 kind，我们自己的条目留默认。
 */
export function reminderMessage(key: string, text: string, source?: MessageSource): UserMessage {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: {
      ...(source ?? { kind: "context-assembler", form: "instructions" }),
      id: key,
    } as MessageSource,
  });
}
