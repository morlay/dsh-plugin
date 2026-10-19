import { Module, type ProviderList } from "@morlay/zephyr";
import { CommandCompact } from "./command.service.ts";

const providers = (): ProviderList => [CommandCompact];

@Module({ providers: providers() })
export class CommandCompactModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
