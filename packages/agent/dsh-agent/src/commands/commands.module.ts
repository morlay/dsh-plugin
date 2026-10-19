import { Module, type ProviderList } from "@morlay/zephyr";
import { CommandsDefault } from "./commands.service.ts";

const providers = (): ProviderList => [CommandsDefault];

@Module({ providers: providers() })
export class CommandsModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
