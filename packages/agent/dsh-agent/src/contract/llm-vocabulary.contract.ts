// LLM 的**调用面词汇**（上游 `@deepseek-ai/dsh-llm`）：请求选项、响应块、模型信息与失败码。
//
// 适配基类 `LlmAdapter` 不在这里：它是实现基类，走 `/server`（`packages/agent/dsh-agent/src/server`）。
export {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  createDeveloperMessage,
  createMessage,
  createToolResultMessage,
} from "@deepseek-ai/dsh-llm";
export type {
  GenerateOptions,
  LlmCallConfig,
  LlmResolvedModelInfo,
  StreamChunk,
} from "@deepseek-ai/dsh-llm";

// 一次失败请求的两件事实：归一化后的失败（`agent/request-error` 的 `failure`）与当时生效的重试策略
// （同一事件的 `retryPolicy`）。订阅那条事件的包要按这两个词声明参数表，所以它们在契约面上。
/** 可序列化的模型请求失败事实（provider/transport 归一化后的结果）。 */
export type { LlmFailure } from "@deepseek-ai/dsh-llm";
/** provider 注册那一刻捕获、之后不变的重试策略。 */
export type { ResolvedRetryPolicy } from "@deepseek-ai/dsh-llm";
