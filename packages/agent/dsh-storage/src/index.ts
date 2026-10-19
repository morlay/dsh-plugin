// storage 的主面：契约 + 域行 + 装配模块。
//
// 后端实现是**子 domain**（`@morlay/dsh-storage/persistence`）：入口不聚合一切，
// 装配面要具体后端时显式引那个子出口。
export * from "./storage.contract.ts";
export * from "./storage-domain.contract.ts";
export * from "./storage.service.ts";
export * from "./storage-domain.service.ts";
export * from "./storage.module.ts";
