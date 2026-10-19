import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionStoreDefault } from "./session.service.ts";

const providers = (): ProviderList => [SessionStoreDefault];

@Module({ providers: providers() })
export class SessionModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
