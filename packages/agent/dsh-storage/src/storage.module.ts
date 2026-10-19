import { Module, type ProviderList } from "@morlay/zephyr";
import { StorageDefault } from "./storage.service.ts";
import { StorageDomainDefault } from "./storage-domain.service.ts";
import { StorageBackendJson } from "./persistence/storage-json.service.ts";

/** 存储根目录由**装配面显式给**（路径只从 `AppEnv` 来：不读 env、不向上找目录）。 */
const providers = (root: string): ProviderList => [
  StorageDefault,
  StorageBackendJson.withConfig({ root }),
  StorageDomainDefault.withConfig({ backend: "json" }),
];

@Module({ providers: providers(".") })
export class StorageModule {
  /** 装配面用：`StorageModule.withConfig(resolve(dataDir, "storages"))`。 */
  static withConfig(root: string): ProviderList {
    return providers(root);
  }
}
