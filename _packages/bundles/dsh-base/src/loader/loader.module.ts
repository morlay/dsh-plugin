import { Module, type ProviderList } from "@morlay/zephyr";
import { TypertLoader } from "./typert-loader.service.ts";
import { PluginPackageInventoryDeepseek } from "./package-inventory.service.ts";

const providers = (): ProviderList => [
  TypertLoader,
  PluginPackageInventoryDeepseek,
];

@Module({ providers: providers() })
export class LoaderModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
