// 拼 class 名：CSS Modules 的映射查表给 `string | undefined`（`exactOptionalPropertyTypes` 下没命中的键是
// undefined），一个没命中的类名不该在 DOM 上留一个空串。
export function classes(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}
