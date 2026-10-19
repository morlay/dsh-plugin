import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionLogDeepseek } from "./deepseek.service.ts";

const providers = (): ProviderList => [SessionLogDeepseek];

@Module({ providers: providers() })
export class SessionLogDeepseekModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
