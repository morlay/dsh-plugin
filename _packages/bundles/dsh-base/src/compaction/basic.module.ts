import { Module, type ProviderList } from "@morlay/zephyr";
import { CompactionBasic } from "./basic.service.ts";

const providers = (): ProviderList => [CompactionBasic];

@Module({ providers: providers() })
export class CompactionBasicModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
