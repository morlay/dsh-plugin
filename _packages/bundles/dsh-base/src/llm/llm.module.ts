import * as LlmPiAiPlugin from "@deepseek-ai/dsh-llm-pi-ai";
import { Module, type ProviderList } from "@morlay/zephyr";
import { LlmDefault } from "./llm.service.ts";
import { LlmPiAi } from "./llm-pi-ai.service.ts";
import { DeepseekLlmApiExtensionsDefault } from "./deepseek-llm-api-extensions.service.ts";
import { LlmDeepseekAccount } from "./llm-deepseek-account.service.ts";
import { LlmDeepseek } from "./llm-deepseek.service.ts";

export type LlmPiAiOptions = Parameters<typeof LlmPiAiPlugin.Config>[0];

const providers = (options: { llmPiAi?: LlmPiAiOptions } = {}): ProviderList => [
  LlmDefault,
  ...(options.llmPiAi == null ? [LlmPiAi] : [LlmPiAi.withConfig(options.llmPiAi)]),
  DeepseekLlmApiExtensionsDefault,
  LlmDeepseekAccount,
  LlmDeepseek,
];

@Module({ providers: providers() })
export class LlmModule {
  static withConfig(options: { llmPiAi?: LlmPiAiOptions } = {}): ProviderList {
    return providers(options);
  }
}
