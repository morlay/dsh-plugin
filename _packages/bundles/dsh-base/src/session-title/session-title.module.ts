import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionTitleDefault } from "./session-title.service.ts";

const providers = (): ProviderList => [SessionTitleDefault.withConfig({ fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })];

@Module({ providers: providers() })
export class SessionTitleModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
