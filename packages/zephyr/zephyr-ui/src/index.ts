/**
 * 引用解析的 host 侧工具。
 *
 * 本包是**普通库**（UI 原语 + 引用解析），不是 cordis 插件包：没有 `./client` 那类"浏览器半"出口，
 * 默认出口就是库本体（浏览器组件），这里只留 host 侧也用得着的那部分。
 */
export { findReferences, parseReferenceToken } from "./reference.ts";
export type { Reference, ReferenceSpan } from "./reference.ts";
