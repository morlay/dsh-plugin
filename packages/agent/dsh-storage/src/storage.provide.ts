import { provide } from "@morlay/zephyr";
import { StorageDefault } from "./storage.service.ts";
import { StorageDomainDefault } from "./storage-domain.service.ts";

/**
 * 存储 hub + 域行。**具体后端不在这里**：json 后端是 `@morlay/dsh-storage` 的
 * `provideStorageJson`（它要 `root`，路径由装配面从 `AppEnv.dataDir` 派生），装配面把两者一起装上。
 *
 * 后端的默认值交给 `StorageDomainDefault` 自己的构造期缺省（`json`）：这里**不写 defaults**，
 * 否则调用方的 `configure(StorageDomainDefault, { backend: "rdb" })` 会死在默认值后面。
 */
export const provideStorage = provide([StorageDefault, StorageDomainDefault]);
