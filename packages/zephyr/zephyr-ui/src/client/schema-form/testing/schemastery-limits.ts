// 上游 `@deepseek-ai/schemastery` 的**声明面比运行期窄**的两处：这里的两个函数是唯一收窄点。
//
// 另一头是第三方类型声明（`vendor/**` 只读，改了上游同步就丢），所以按票的判据它们进 `BRIDGES`：
// 白名单只覆盖**本文件**——用例里那些「局部替身」的断言不在这里放行。

/**
 * 一段本地化字典当 `description` 用。
 *
 * `Schema.description()` 的声明只写 `string`，运行期与我们的 `FieldMeta.description` 都收字典
 * （渲染层按 locale 解析，见 `schema-node.ts`）。
 * @param localized - 键 → 文案。
 * @returns 声明面里的 `string`（运行期就是那本字典）。
 */
export function localizedDescription(localized: Readonly<Record<string, string>>): string {
  return localized as unknown as string;
}

/**
 * `null` 当 `.default()` 用（「默认没有」的那种声明）。
 *
 * `Schema.default(value)` 的形参不收 `null`，而 schema 里「默认空」确实写成 `null`
 * （会话模式的 `defaultModel` 就是这种）。
 * @returns 声明面里的默认值类型（运行期就是 `null`）。
 */
export function nullDefault<T>(): T {
  return null as unknown as T;
}
