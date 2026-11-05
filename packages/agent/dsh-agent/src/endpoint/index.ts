// agent 域的**端点面**（`@morlay/dsh-agent/endpoint`）：两端共用的值与类型。
//
// 上游把 LLM 的 remote 放在 `@deepseek-ai/dsh-llm/remote`，那归 agent 域所有；client 半（setting 的
// 模型设置页）从这里取，不再直连 `@deepseek-ai/dsh-llm`。放在 endpoint 而不是 contract：
// contract 只放抽象类 / 类型 / 纯函数，remote 令牌与 deps 键是两端共用的**值**。
export { TYPERT_REMOTE as LLM_REMOTE } from "@deepseek-ai/dsh-llm/remote";

/** wire 上的组名。 */
export const LLM_GROUP = "llm" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.llm`）。 */
export const LLM_REMOTE_KEY = "remote.llm" as const;
// 子代理的 RPC 契约（`subagents/*`）：两端共用的形状。宿主实现在 `@morlay/dsh-agent-loop`。
export * from "./subagents-endpoint.ts";
