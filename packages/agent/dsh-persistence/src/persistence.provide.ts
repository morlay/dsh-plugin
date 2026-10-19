import { configure, provide } from "@morlay/zephyr";
import { StorageJsonDefault } from "./storage-json.service.ts";

/**
 * 存储根目录由**装配面显式给**（路径只从 `AppEnv` 来：不读 env、不向上找目录）。
 *
 * 装配面要换值：`providePersistence(configure(StorageJsonDefault, { root }))`。
 */
export const providePersistence = provide(configure(StorageJsonDefault, { root: "." })([StorageJsonDefault]));
