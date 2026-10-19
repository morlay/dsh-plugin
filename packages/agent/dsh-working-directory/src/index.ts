// working-directory 域的包根：契约 + 行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./working-directory.service.ts";
export * from "./working-directory.provide.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-working-directory`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-working-directory";
