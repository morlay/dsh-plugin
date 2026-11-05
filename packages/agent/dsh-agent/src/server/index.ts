// agent 的**宿主半**（`@morlay/dsh-agent/server`）：wire 端点实现 + 装配函数。
//
// **默认实现在包根**（root）：这里只放"要装到线上"的东西——端点实现与 `provideXxx`。
// 这样测试能分层：headless（root + 契约）→ headless + server → + ui。
export { provideLlmRemote } from "./llm-remote.provide.ts";
export { provideWorkingDirectory } from "./working-directory.provide.ts";
export { provideEnvTools } from "./tools.provide.ts";

// 端点实现（`../endpoint/` 契约的宿主半）。
export { LlmEndpoint } from "./llm-endpoint.service.ts";

// 上游 llm 的**值面**：`LlmAdapter`（适配基类）、`MessageId` / `ToolCallId`（品牌铸造函数）。
// 放宿主半而不是包根：它们的运行时依赖 `createRequire`，浏览器侧不该加载。
export { LlmAdapter, MessageId, ToolCallId } from "@deepseek-ai/dsh-llm";

// 上游 subagent 的公开词（契约与端点都从这里取）。
export type { SubagentPromptRequest } from "@deepseek-ai/dsh-subagent";
export type SubagentRuntime = InstanceType<typeof import("@deepseek-ai/dsh-subagent").default>;
