import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionProjectionDefault } from "./session-projection.service.ts";

const providers = (): ProviderList => [SessionProjectionDefault];

@Module({ providers: providers() })
export class SessionProjectionModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
