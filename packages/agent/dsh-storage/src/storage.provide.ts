import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { StorageDefault } from "./storage.service.ts";
import { StorageDomainDefault } from "./storage-domain.service.ts";

/**
 * 存储 hub + 域行。**具体后端不在这里**：json 后端是 `@morlay/dsh-persistence` 的
 * `providePersistence`（它要 `root`，路径由装配面从 `AppEnv.dataDir` 派生），装配面把两者一起装上。
 */
const providers = (): ProviderList => [StorageDefault, configure(StorageDomainDefault, { backend: "json" })([StorageDomainDefault])];

export const provideStorage = provide(providers());
