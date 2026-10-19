import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionProjectionCacheDefault } from "./session-projection-cache.service.ts";

const providers = (): ProviderList => [SessionProjectionCacheDefault.withConfig({ writeEveryEvents: 200, writeIntervalMs: 5000 })];

@Module({ providers: providers() })
export class SessionProjectionCacheModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
