import type { ReferenceInsert } from "../../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/draft-editor.ts";
import {
  findReferences,
  formatReference,
  formatReferenceMention,
  type Reference,
} from "@morlay/dsh-client-ui-primitives/client";

const SKILL_TEXT = /^\/([\w-]+)\s*$/u;

// 插入文本按「预定形态」归一，与谁产出无关：file / folder 是 `@` 前缀 mention（含空格加引号），
// skill 是 `skill:` token。产生方给什么字符串都先解析回结构化引用，再按这一形态写回草稿。
export function referenceTextOf(insert: ReferenceInsert): ReferenceInsert {
  const reference = fileAppearanceReferenceOf(insert);
  return reference === undefined
    ? insert
    : { ...insert, clipboardText: formatReferenceMention(reference) };
}

export function insertTextOf(text: string): string {
  const name = SKILL_TEXT.exec(text)?.[1];
  if (name === undefined) return text;
  const tail = text.endsWith(" ") ? " " : "";
  return `${formatReference({ protocol: "skill", path: name })}${tail}`;
}

function fileAppearanceReferenceOf(insert: ReferenceInsert): Reference | undefined {
  if (insert.appearance !== "file" && insert.appearance !== "folder") return undefined;
  // 产生方可能交一个还没闭合的引号 mention（含空格的目录 pick 保留输入态），补上闭合引号再交给
  // 统一解析认领——认领规则始终只有解析器那一份。
  const ref =
    insert.ref.startsWith('@"') && !insert.ref.endsWith('"') ? `${insert.ref}"` : insert.ref;
  return findReferences(ref).find((span) => span.reference.protocol === "file")?.reference;
}
