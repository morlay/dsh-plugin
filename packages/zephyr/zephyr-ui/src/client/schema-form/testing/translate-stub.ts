// `SchemaFormTranslate` 的测试替身：按字典取模板，`{name}` 占位用实参填。
//
// 三个 spec（controller / value / editor / real-configs）原本各抄一份「字典 → 翻译函数」的实现，
// 每份还各带两处 `as unknown as`。这种替身只有一种做法，收在这里一处：上下文推断出
// `SchemaFormTranslate` 的形参类型，实现里不需要任何断言。
import type { SchemaFormTranslate } from "../slot-contract.ts";

/**
 * 字典 → 翻译函数。
 * @param dictionary - 键 → 模板（用例只写自己用到的那几条）。
 * @returns `SchemaFormTranslate` 的替身；缺键时回落键名。
 */
export function translateOf(dictionary: Readonly<Record<string, string>>): SchemaFormTranslate {
  return (key, params) => {
    const template = dictionary[key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value: unknown = Reflect.get(params, name);
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
    });
  };
}
