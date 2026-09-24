/**
 * 字段默认值与文本解析：默认值就是行内值（`value.tsx`），这里只剩"什么文本算这个字段接受的值"的规则。
 *
 * 行式视图里值在行内点开编辑，编辑的文本交给草稿模型、保存那一刻才按这里的规则解析。
 */

export {
  InlineValue,
  isMultiline,
  SchemaFieldDefault,
  tokenText,
  tokenTone,
  valueText,
} from "./value.tsx";
import type { TextParse } from "./draft.ts";
import type { FieldNode } from "./schema-node.ts";
import type { SchemaFormTranslate } from "./slot-contract.ts";

/** 各类型的文本解析规则（消息来自本包字典）。 */
export function parseFor(node: FieldNode, t: SchemaFormTranslate): TextParse {
  switch (node.type) {
    case "number":
      return (text) => {
        const trimmed = text.trim();
        const value = Number(trimmed);
        if (trimmed === "" || !Number.isFinite(value))
          return { kind: "invalid", message: t("invalidNumber") };
        if (node.meta.step === 1 && !Number.isInteger(value)) {
          return { kind: "invalid", message: t("invalidInteger") };
        }
        return { kind: "value", value };
      };
    case "boolean":
      return (text) => {
        const trimmed = text.trim();
        if (trimmed === "true") return { kind: "value", value: true };
        if (trimmed === "false") return { kind: "value", value: false };
        return { kind: "invalid", message: t("invalidBoolean") };
      };
    case "const":
      return (text) =>
        text === String(node.type === "const" ? node.value : "") ||
        text.trim() === JSON.stringify(node.value)
          ? { kind: "value", value: node.value }
          : { kind: "invalid", message: t("invalidConst") };
    case "bitset":
      return (text) => {
        const value = Number(text.trim());
        return Number.isFinite(value)
          ? { kind: "value", value }
          : { kind: "invalid", message: t("invalidNumber") };
      };
    case "any":
      return (text) => {
        try {
          return { kind: "value", value: JSON.parse(text) };
        } catch {
          return { kind: "invalid", message: t("invalidJson") };
        }
      };
    default:
      return (text) => ({ kind: "value", value: text });
  }
}
