// agent 域的**契约面**（`@morlay/dsh-agent/contract`）：进程内的端口，不涉及 remote。
export * from "./agent-directory.contract.ts";
export * from "./tool-vocabulary.contract.ts";
export * from "./llm-vocabulary.contract.ts";
export * from "./prompt-vocabulary.contract.ts";
export * from "./composition-vocabulary.contract.ts";
export * from "./agent-default-model.contract.ts";
export * from "./launch-environment.contract.ts";
export * from "./llm.contract.ts";
export * from "./tool-registry.contract.ts";
// per-agent 分层的声明面（`AgentProviderGroup` / `@AgentScoped()`）：边界由 agent 声明。
export * from "./agent-scope.ts";
export * from "./system-prompt.contract.ts";
export * from "./working-directory.contract.ts";
// LLM API 扩展注册表的契约（原 `dsh-setting`，LLM 是 agent 的核心能力）。
export * from "./deepseek-llm-api-extensions.contract.ts";
// 原 `dsh-subagent` 包的运行时契约（现在属 agent 的核心能力）。
export * from "./subagent-registry.contract.ts";
// MCP 客户端行的声明面（`@McpClient`）：声明是契约的一部分。
export * from "./mcp-client.decorator.ts";
// 事件名（`Events` 命名空间）：也是契约的一部分。用命名空间导出，消费处一眼看出这是事件。
export * as Events from "./events.ts";

// 子代理的**请求形状**（上游 `dsh-subagent` 的公开类型）：属 agent 域的契约面，下游从这里取。
export type { SubagentPromptRequest, SubagentPromptRequestId } from "@deepseek-ai/dsh-subagent";
