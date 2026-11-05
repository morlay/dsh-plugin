// agent 的包根：**骨架**（契约 + 默认实现）与**headless 装配**。
//
// 分层：root 是 headless（契约 + 默认实现 + `provideAgent()`）；`./server` 只放 wire（端点实现 +
// 带远端的装配）；`./ui`（若有）只放浏览器面。测试因此能按层跑：headless → + server → + ui。
// **循环期的实现在 `@morlay/dsh-agent-loop`**：一轮里的执行器、检查点、工具输出与调用策略、
// 子代理派生都归它；这里只留"agent 是什么"以及边界声明（`@McpClient`）。
export * from "./contract/index.ts";

/** headless 装配：目录 / 模型 / 提示词 / 工具注册表（不带 wire）。 */
export { provideAgent } from "./agent.provide.ts";
/** headless 装配：工作目录行与它的工具行。 */
export { provideWorkingDirectory } from "./server/working-directory.provide.ts";
export { provideEnvTools } from "./server/tools.provide.ts";

// 上游 llm 的**门面**：消费方不直接引 `@deepseek-ai/dsh-llm`，一律从本包取。
// **只转类型**：值面（`LlmAdapter` / `MessageId` / `ToolCallId`）会加载上游运行时，出在 `./server`。
export type {
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmProviderInfo,
  LlmRuntime,
  StreamChunk,
  UserMessage,
} from "@deepseek-ai/dsh-llm";

// per-agent 装配契约（02 会并入本包）。
export * from "./contract/index.ts";

// 骨架的**默认实现**（随包根导出；`./server` 只有 wire 与装配）。
export * from "./agent-directory.service.ts";
export * from "./agent-default-model.service.ts";
export * from "./launch-environment.service.ts";
export * from "./llm.service.ts";
export * from "./llm-retry.service.ts";
export * from "./system-prompt.service.ts";
export * from "./timer.service.ts";
export * from "./tool-registry.service.ts";

// 骨架实现：子代理注册表、MCP 资源、LLM API 扩展注册表、工作目录与它的工具行。
export * from "./subagent-registry.service.ts";
export * from "./mcp-resources.service.ts";
export * from "./deepseek-llm-api-extensions.service.ts";
export * from "./working-directory.service.ts";
export * from "./working-directory.tool.ts";
// LLM provider 的**配置行**（两家 provider：DeepSeek API key / pi-ai）：属 agent 的装配。
export { LlmDeepseek } from "./llm-deepseek.service.ts";
export { LlmPiAi } from "./llm-pi-ai.service.ts";
export { provideLlmProviders } from "./llm-providers.provide.ts";
