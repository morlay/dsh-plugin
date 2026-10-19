// agent 的**宿主半**（`@morlay/dsh-agent/server`）：宿主面的装配函数 + wire 端点实现。
//
// 装配面只从这里取 `provideXxx`（host 侧）；契约与默认实现在包根。
export { provideAgent } from "./agent.provide.ts";
export { provideLlmRemote } from "./llm-remote.provide.ts";
export { provideSessionReference } from "./session-reference.provide.ts";

// 端点实现（`../endpoint/` 契约的宿主半）。
export { SessionReferenceDefault } from "./session-reference.service.ts";
export { LlmEndpoint } from "./llm-endpoint.service.ts";

// 上游 llm 的**值面**：`LlmAdapter`（适配基类）、`MessageId` / `ToolCallId`（品牌铸造函数）。
// 放宿主半而不是包根：它们的运行时依赖 `createRequire`，浏览器侧不该加载。
export { LlmAdapter, MessageId, ToolCallId } from "@deepseek-ai/dsh-llm";
export * from "./agent-default-model.service.ts";
export * from "./agent-directory.service.ts";
export * from "./agent-loop.service.ts";
export * from "./launch-environment.service.ts";
export * from "./llm-retry.service.ts";
export * from "./llm.service.ts";
export * from "./system-prompt.service.ts";
export * from "./timer.service.ts";
export * from "./tool-executor.service.ts";
export * from "./tool-registry.service.ts";
