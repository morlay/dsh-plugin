// system prompt 的“变化部分”不再挤进 system，而是作为一条 `<system-remainder>` 的 user 消息追加到历史尾部：
// system 稳定 → 前缀缓存可复用；变化只在历史里追加，且只有内容变了才追加。
//
// 这里只放纯函数：怎么收集 section、什么时候 append 由插件接线，边界测试写在 `__tests__/system-remainder.spec.ts`。

import type { UserMessage } from "@deepseek-ai/dsh-llm";

// 一段会被搬进 remainder 的文本（section 名 + 文本）。
export interface RemainderSection {
  readonly name: string;
  readonly text: string;
}

// 按 section 顺序拼成一段稳定文本：名字保留，方便模型知道每段是什么。
export function renderRemainder(sections: readonly RemainderSection[]): string {
  return sections
    .filter((section) => section.text.trim().length > 0)
    .map((section) => `## ${section.name}\n\n${section.text.trim()}`)
    .join("\n\n");
}

// 与上一份比较：空白差异不算变化，避免每步都追加一条。
export function remainderChanged(previous: string | undefined, next: string): boolean {
  return (previous ?? "").trim() !== next.trim();
}

// 会话里落盘用的 user 消息（`id` 由 Session 分配）。
export type RemainderMessage = Omit<UserMessage, "id">;

// 包成一条 user 消息；空内容返回 undefined（不追加）。
export function remainderMessage(text: string): RemainderMessage | undefined {
  const body = text.trim();
  if (body.length === 0) return undefined;
  return {
    role: "user",
    content: [{ type: "text", text: `<system-remainder>\n${body}\n</system-remainder>` }],
    source: { kind: "user" },
  };
}
