/**
 * 字段文案：标签兜底与说明解析。
 *
 * 标签没有 schema 声明可用（schemastery 的 meta 没有 title/label），所以先是字段名兜底（驼峰/下划线拆词），
 * 业务方经字段槽给 label/hint 时以槽为准；说明取 `description`（可本地化）与 `comment`。
 */

import type { FieldNode } from "./schema-node.ts";

/** 把 schema 里的本地化文本解析成当前语言；由 locale 服务提供。 */
export type ResolveText = (text: string | Readonly<Record<string, string>>) => string;

/** 字段名兜底的可读标签：拆词并首字母大写，`0`/`1` 这类索引保持原样。 */
export function humanizeKey(key: string): string {
  if (key.length === 0) return "";
  if (/^\d+$/.test(key)) return key;
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** 字段的说明（`description` 本地化后 + `comment`），没有就是 undefined。 */
export function fieldHint(node: FieldNode, resolveText: ResolveText): string | undefined {
  const parts: string[] = [];
  if (node.meta.description !== undefined) parts.push(resolveText(node.meta.description));
  if (node.meta.comment !== undefined) parts.push(node.meta.comment);
  return parts.length === 0 ? undefined : parts.join(" ");
}
