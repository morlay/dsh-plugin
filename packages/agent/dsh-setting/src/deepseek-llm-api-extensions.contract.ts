// DeepSeek LLM API 扩展注册表契约：令牌按服务语义命名。
import type DeepSeekLlmApiExtensionRegistry from "@deepseek-ai/dsh-deepseek-llm-api-extensions";
import { Injectable } from "@morlay/zephyr";

interface DeepseekLlmApiExtensionsFace {
  readonly register: DeepSeekLlmApiExtensionRegistry["register"];
}

@Injectable()
export abstract class DeepseekLlmApiExtensions implements DeepseekLlmApiExtensionsFace {
  abstract readonly register: DeepseekLlmApiExtensionsFace["register"];
}
