import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { Module, type ProviderList } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { StorageDefault } from "./storage.service.ts";
import { StorageDomainDefault } from "./storage-domain.service.ts";
import { StorageBackendJson } from "./storage-json.service.ts";

const providers = (): ProviderList => [
  StorageDefault,
  StorageBackendJson.withConfig({ root: jsExpr(() => dshHomePath("storages")) }),
  StorageDomainDefault.withConfig({ backend: "json" }),
];

@Module({ providers: providers() })
export class StorageModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
