// 引用解析的 host 侧工具（出口 `./reference`）。
//
// 本包是**普通库**（UI 原语 + 引用解析），不是 cordis 插件包：默认出口是浏览器组件库，这里只留 host 侧也用得着
// 的那部分——纯函数，不碰 React。
// 解析模块住在浏览器面（`src/client/reference.ts`）：两个出口共用同一份实现，不另抄一份。
export { findReferences, parseReferenceToken } from "./client/reference.ts";
export type { Reference, ReferenceSpan } from "./client/reference.ts";
