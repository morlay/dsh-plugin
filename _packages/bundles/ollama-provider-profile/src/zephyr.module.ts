// 本 bundle 的装配真源：`providers` 只表达运行期组合——能力包用 `<Provider>.withConfig(...)`，
// 官方行用 `<官方适配>.withConfig(...)`。哪些行要 insert、哪些只覆盖 config，是生成器相对目标
// profile 的差值，不在代码里表达；能力包的行名由 Provider 定义文件所属的 `package.json` 推导。

import { WebSearchOllama } from "@morlay/dsh-web-search-ollama";
import { LlmPiAi, type LlmPiAiOptions } from "@morlay/dsh-base/llm";
import { WebDefault } from "@morlay/dsh-base/web";
import { Module } from "@morlay/zephyr";

// `llm-pi-ai` 的 ollama provider；配置整体替换、不是深合并，所以字段写全。
const LLM_PI_AI_CONFIG: LlmPiAiOptions = {
  providers: {
    ollama: {
      apiKeyEnv: "OLLAMA_API_KEY",
      displayName: "Ollama Cloud",
      api: "openai-completions",
      baseURL: "https://ollama.com/v1",
      reasoning: "high",
      // 图片上限按 llm-deepseek 的默认对齐：每张请求版本的原始字节目标 2 MiB（pi-ai 默认 1 MiB）。
      requestImageMaxBytes: 2 * 1024 * 1024,
      models: [
        {
          id: "deepseek-v4.1-flash:1017",
          name: "DeepSeek V4.1 Flash 1017 @ Ollama Cloud",
          contextWindow: 1000000,
          input: ["text", "image"],
          reasoningEfforts: {
            off: null,
            low: "low",
            high: "high",
            max: "max",
          },
        },
      ],
    },
  },
};

@Module({
  providers: [
    LlmPiAi.withConfig(LLM_PI_AI_CONFIG),
    // config 是整体替换、不是深合并——`fetchProvider` 必须跟着写全。
    WebDefault.withConfig({ searchProvider: "ollama", fetchProvider: "http" }),
    WebSearchOllama.withConfig({ apiKeyEnv: "OLLAMA_API_KEY" }),
  ],
})
export class OllamaProviderProfileModule {}
