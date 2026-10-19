import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { SessionTitleLlm } from "./first-prompt-llm.service.ts";

const providers = (): ProviderList => [configure(SessionTitleLlm, { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 4096, timeoutMs: 60000 })([SessionTitleLlm])];

export const provideSessionTitleLlm = provide(providers());
