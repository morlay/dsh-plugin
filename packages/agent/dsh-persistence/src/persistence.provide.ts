import { provide } from "@morlay/zephyr";
import { StorageJsonDefault } from "./storage-json.service.ts";

/**
 * 存储根目录：默认取 `AppEnv.values.dataDir`，装配面可用 `configure` 覆盖。
 *
 * 路径只从 `AppEnv` 来（不读 env、不向上找目录）；这里不给 `root`，让行自己按 dataDir 落位——
 * 给 `"."` 会让数据落到进程 cwd，与 dataDir 脱节。
 */
export const providePersistence = provide([StorageJsonDefault]);
