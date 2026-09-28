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

/**
 * 各类型的文本解析规则（消息来自本包字典）。
 *
 * 解析不只看类型：schema 上声明的界限（`pattern` / `min` / `max` / `step`）与字面量集合都在这里说话——
 * 用户敲完当场就知道对不对，而不是等保存时被整段校验退回。
 * @param node - 字段节点（`meta` 是约束的来源）。
 * @param t - 本包字典。
 * @returns 这段文本的解析规则。
 */
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
        const { min, max } = node.meta;
        if (min !== undefined && max !== undefined && (value < min || value > max)) {
          return { kind: "invalid", message: t("invalidRange", { min, max }) };
        }
        if (min !== undefined && value < min) {
          return { kind: "invalid", message: t("invalidMin", { min }) };
        }
        if (max !== undefined && value > max) {
          return { kind: "invalid", message: t("invalidMax", { max }) };
        }
        return { kind: "value", value };
      };
    case "string": {
      // 声明了 `pattern()` 就按它判：不匹配的文本不进草稿。
      const pattern = node.meta.pattern;
      if (pattern === undefined) return (text) => ({ kind: "value", value: text });
      return (text) =>
        new RegExp(pattern).test(text)
          ? { kind: "value", value: text }
          : { kind: "invalid", message: t("invalidPattern", { pattern }) };
    }
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
      // 字面量集合的 union（枚举那种）：只收集合里的成员。
      if (node.type === "union" && node.choices !== undefined) {
        const choices = node.choices;
        const options = choices.map((choice) => String(choice)).join(" / ");
        return (text) =>
          choices.some((choice) => String(choice) === text)
            ? { kind: "value", value: text }
            : { kind: "invalid", message: t("invalidChoice", { choices: options }) };
      }
      return (text) => ({ kind: "value", value: text });
  }
}
