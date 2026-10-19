import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type MessageSource } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-session";

const REMINDER_OPEN = "<system-reminder";
const REMINDER_CLOSE = "</system-reminder>";

// 覆盖规则在系统提示词里声明一次（见 [`rules.ts`](./rules.ts)），每条 reminder 只带 id 与正文。
export const RULES_SECTION = "assembler:rules";

// 通道自己的条目形态：降级出来的规则块，幂等键是 id。
export interface PromptReminderSource {
  kind: "context-assembler";
  form: "instructions";
  // 条目 id：同 id 的最新一条取代更早的同 id 条目；可选——既有消息里可能没有它。
  id?: string;
}

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "context-assembler": PromptReminderSource;
  }
}

// 这条消息是不是通道注入的条目——判据是 source 里的幂等键（`id`），不是 kind：覆盖按 id 判定，kind 只描述
// 这条消息对外的身份。
function promptEntryIdOf(source: MessageSource): string | undefined {
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

// surface 上最近一条该 id 的 reminder 原文（含信封）；没有则 undefined。
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

// 注入一条提醒：`text` 是已渲染好的正文（规则块），`key` 是它的幂等键。
export function reminderMessage(key: string, text: string): UserMessage {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "context-assembler", form: "instructions", id: key },
  });
}
