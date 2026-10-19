import * as LlmPiAiPlugin from "@deepseek-ai/dsh-llm-pi-ai";
import { Module, type ProviderList } from "@morlay/zephyr";
import { LlmDefault } from "./llm.service.ts";

export type LlmPiAiOptions = Parameters<typeof LlmPiAiPlugin.Config>[0];

const providers = (
  options: { llmPiAi?: LlmPiAiOptions } = {},
): ProviderList => [
  LlmDefault,
  ...(options.llmPiAi == null
    ? []
    : [[]]),
];

@Module({ providers: providers() })
export class LlmModule {
  static withConfig(options: { llmPiAi?: LlmPiAiOptions } = {}): ProviderList {
    return providers(options);
  }
}
