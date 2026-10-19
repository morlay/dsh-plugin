import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionTitleLlm } from "./first-prompt-llm.service.ts";

const providers = (): ProviderList => [SessionTitleLlm.withConfig({ targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 4096, timeoutMs: 60000 })];

@Module({ providers: providers() })
export class SessionTitleLlmModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
