import type { UserMessage } from "@deepseek-ai/dsh-session";
import { findReferences, parseReferenceToken } from "@morlay/dsh-client-ui-primitives";
import { fromMarkdown } from "mdast-util-from-markdown";

const SKILL_PROTOCOL = "skill";

const FILE_PROTOCOL = "file";

const AT_PREFIX = "@";

interface MarkdownNode {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly MarkdownNode[];
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function inlineCodeSkillNames(text: string): string[] {
  const names: string[] = [];
  const root = fromMarkdown(text) as unknown as MarkdownNode;
  walk(root, (node) => {
    if (node.type !== "inlineCode" || node.value === undefined) return;
    const reference = parseReferenceToken(node.value);
    if (reference?.protocol === SKILL_PROTOCOL && reference.path !== undefined) {
      names.push(reference.path);
    }
  });
  return names;
}

// 注入只能由用户自己的手势触发：外部文本伪造不了 `source.kind === 'user'`。
function forEachTextBlock(messages: readonly UserMessage[], visit: (text: string) => void): void {
  for (const message of messages) {
    if ((message.source as { kind?: unknown }).kind !== "user") continue;
    for (const block of message.content) {
      if (block.type !== "text") continue;
      visit(block.text);
    }
  }
}

export function skillNamesIn(messages: readonly UserMessage[]): string[] {
  const names: string[] = [];
  const push = (name: string | undefined): void => {
    if (name === undefined || name === "" || names.includes(name)) return;
    names.push(name);
  };
  forEachTextBlock(messages, (text) => {
    for (const span of findReferences(text)) {
      if (span.reference.protocol !== SKILL_PROTOCOL) continue;
      push(span.reference.path);
    }
    for (const name of inlineCodeSkillNames(text)) push(name);
  });
  return names;
}

export interface FileReference {
  readonly path: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}

// 只认 `@` 起手的路径：`file:x` 与 `[label](x)` 都是普通文本；列在 read 里没有语义，丢弃。
export function fileReferencesIn(messages: readonly UserMessage[]): FileReference[] {
  const references: FileReference[] = [];
  forEachTextBlock(messages, (text) => {
    for (const span of findReferences(text)) {
      const reference = span.reference;
      if (text[span.start] !== AT_PREFIX || reference.protocol !== FILE_PROTOCOL) continue;
      const path = reference.path;
      if (path === undefined || path === "") continue;
      const lineStart = reference.lineStart;
      const next: FileReference = {
        path,
        ...(lineStart === undefined ? {} : { lineStart }),
        ...(lineStart === undefined || reference.lineEnd === undefined
          ? {}
          : { lineEnd: reference.lineEnd }),
      };
      if (references.some((known) => sameWindow(known, next))) continue;
      references.push(next);
    }
  });
  return references;
}

function sameWindow(left: FileReference, right: FileReference): boolean {
  return (
    left.path === right.path && left.lineStart === right.lineStart && left.lineEnd === right.lineEnd
  );
}
