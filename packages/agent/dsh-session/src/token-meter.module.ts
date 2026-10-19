import { Module, type ProviderList } from "@morlay/zephyr";
import { TokenMeterDefault } from "./token-meter.service.ts";

const providers = (): ProviderList => [TokenMeterDefault];

@Module({ providers: providers() })
export class TokenMeterModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
