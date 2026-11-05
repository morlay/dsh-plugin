export * from "./contract/index.ts";
// storage 的主面：契约 + 域行 + 装配模块。
//
// 后端实现里只有 json 一个（内置，`./storage-json.service.ts`）。其余后端（RDB 等）在各自的域包里，
// 装配面要具体后端时显式装那个 Module。
export * from "./storage.service.ts";
export * from "./storage-domain.service.ts";
export * from "./storage.provide.ts";

// 上游 `storage-domain` 的词按需显式转出：整包透传会把上游整面（含 `apply` 与运行时）拖进本包入口，
// 也说不清到底用了哪几个词。当前没有经包根消费的散装词（域设施走本包契约 `StorageDomain` 或下面那行
// 的命名空间 `StorageDomainPlugin`），所以这里一个都不导；要新词时显式加（类型进 `contract/`）。

// 内置的 json 后端（原来独立的 `dsh-storage-json` 包，拍平进本域）：
// `storage-domain` 的挂载面（KV 域）：属 storage 的面，下游从这里取。
export * as StorageDomainPlugin from "@deepseek-ai/dsh-storage-domain";

export * from "./storage-json.service.ts";
export * from "./persistence.provide.ts";

export { default as StorageHub } from "@deepseek-ai/dsh-storage";
