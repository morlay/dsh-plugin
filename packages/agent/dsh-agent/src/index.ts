// agent 的包根：契约（聚合 `./contract`）+ 默认实现。
// **装配函数不在根上**：宿主面在 `./server`（装配面只从那里取 `provideXxx`）。
//
// 子 domain 是独立包：`@morlay/dsh-command`（命令）、`@morlay/dsh-subagent`（子代理）、
// `@morlay/dsh-tool-policy`（工具调用生命周期上的策略行）、`@morlay/dsh-agent-instruction`（agent 指令）。
// 域内只有一条行、没有第二个消费者的（定时器、启动环境快照）留在本包，不再单开包。
export * from "./contract/index.ts";
// 上游 llm 的**门面**：消费方（命令、检查点、权限、会话等）不直接引 `@deepseek-ai/dsh-llm`，
// 一律从本包取——换实现时只改这一处。
// **只转类型**：值面（`LlmAdapter` / `MessageId` / `ToolCallId`）会加载上游 llm 的运行时
// （它用 `createRequire`，浏览器里直接崩），所以它们出在 `./server`（宿主半）。
export type {
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmProviderInfo,
  LlmRuntime,
  StreamChunk,
  UserMessage,
} from "@deepseek-ai/dsh-llm";
// `/api` 的 `llm/*` 端点行在 `./server`：要 `RemoteHandlers`，由装配面装。
