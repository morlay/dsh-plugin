// 会话身份的**两端共用面**：品牌铸造函数与上游会话类型。
//
// 住 `./endpoint` 而不是包根或单独的 `contract` 面：浏览器半（`./ui`）也要 `SessionId()`，
// 而包根聚合了 host 实现（`*.host.ts` / `*.service.ts`），引包根会把 node-only 运行时拖进浏览器；
// 两端共用的声明只有 `endpoint` 与 `ui` 两个出口，不额外开 `contract`。
// 走上游的 `types` 子路径而不是包根：包根会把 llm 的运行时（`createRequire`）拖进浏览器。
export type { SessionEvent, SessionHeader } from "@deepseek-ai/dsh-session/types";
export { SessionId } from "@deepseek-ai/dsh-session/types";
