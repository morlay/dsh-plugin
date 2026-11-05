export * from "./contract/index.ts";
// storage 的主面：契约 + 域行 + 装配模块。
//
// 后端实现不在这个包：json 后端是 `@morlay/dsh-persistence`（令牌是那一行的适配类自身），
// 装配面要具体后端时显式装那个 Module。依赖方向因此是单向的：后端包 → 这个包的契约。
export * from "./storage.service.ts";
export * from "./storage-domain.service.ts";
export * from "./storage.provide.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-storage-domain`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-storage-domain";
