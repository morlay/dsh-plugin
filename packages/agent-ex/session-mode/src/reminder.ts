// 两种按步送达的条目，身份都写在 `source` 上（不扩上游 `MessageSourceMap`：source 只是随消息落账的普通对象）：
//
// - **通道**（降级 section）：`kind: "context-assembler"`，幂等键是 `id`（一条 section 一个 id），
//   信封是带 id 的 `<system-reminder id="…">`——与源包 `context-assembler/src/reminder.ts` 同形；
// - **工具说明的常驻正文**：借上游已有的 `kind: "skill-invocation"` + `name`（与按需加载的技能同形态），
//   信封是不带 id 的 `<system-reminder>`。
//
// 两者都是同一条 user 消息形态，所以「读哪一条」必须按来源分开，否则会互相顶掉。
import type { Agent } from "@morlay/dsh-agent/contract";
import { createUserMessage, type MessageSource } from "@morlay/dsh-agent/contract";
import type { UserMessage } from "@morlay/dsh-agent/contract";

const REMINDER_OPEN = "<system-reminder";
const REMINDER_CLOSE = "</system-reminder>";

// 覆盖规则在系统提示词里声明一次，每条 reminder 只带 id 与正文。
export const RULES_SECTION = "assembler:rules";

// 通道自己的条目形状：降级出来的规则块，幂等键是 id。
export interface PromptReminderSource {
  readonly kind: "context-assembler";
  readonly form: "instructions";
  readonly id?: string;
}

// 这条消息的通道幂等键：判据是 `id`（不是 kind——kind 只描述这条消息对外的身份）。
export function promptEntryIdOf(source: MessageSource): string | undefined {
  const record = source as { readonly kind?: unknown; readonly id?: unknown };
  if (record.kind !== "context-assembler") return undefined;
  return typeof record.id === "string" ? record.id : undefined;
}

function escapeFrameBody(body: string): string {
  return body.replaceAll(REMINDER_CLOSE, "<\\/system-reminder>");
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

// 带 id 的信封（通道用）。
export function renderReminder(id: string, body: string): string {
  return `${REMINDER_OPEN} id="${escapeAttr(id)}">\n${escapeFrameBody(body)}\n${REMINDER_CLOSE}`;
}

// 不带 id 的信封（工具说明的常驻正文用）：上下各空一行，身份由 `source.name` 给。
export function renderConstantReminder(body: string): string {
  return `${REMINDER_OPEN}>\n\n${escapeFrameBody(body)}\n\n${REMINDER_CLOSE}`;
}

// surface 上最近一条该 id 的 reminder 原文（含信封）；没有则 `undefined`。
// 走 `deriveMessages()`（surface 的派生消息视图，受支持的同步读）而不是逐 seq 读事件。
export function latestReminderText(agent: Agent, id: string): string | undefined {
  for (const message of agent.session.deriveMessages().toReversed()) {
    if (message.role !== "user") continue;
    if (promptEntryIdOf(message.source) !== id) continue;
    const [block] = message.content;
    return message.content.length === 1 && block?.type === "text" ? block.text : "";
  }
  return undefined;
}

// 注入一条提醒：`text` 是已渲染好的正文（规则块），`key` 是它的幂等键。
export function reminderMessage(key: string, text: string): UserMessage {
  // 上游 `MessageSourceMap` 不认这个 kind（通道自己的条目），构造入参在这里断言一次。
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "context-assembler", form: "instructions", id: key } as never,
  });
}

// 工具说明的常驻正文：身份是上游 `skill-invocation` + 组名，信封不带 id。
export function latestConstantText(agent: Agent, name: string): string | undefined {
  for (const message of agent.session.deriveMessages().toReversed()) {
    if (message.role !== "user") continue;
    const source = message.source as { readonly kind?: unknown; readonly name?: unknown };
    if (source.kind !== "skill-invocation" || source.name !== name) continue;
    const [block] = message.content;
    return message.content.length === 1 && block?.type === "text" ? block.text : undefined;
  }
  return undefined;
}

export function constantMessage(name: string, text: string): UserMessage {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "skill-invocation", name, form: "instructions" } as never,
  });
}
