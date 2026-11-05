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
