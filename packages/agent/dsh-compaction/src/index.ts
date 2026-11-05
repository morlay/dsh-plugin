// compaction 域的包根：契约 + 引擎行 + 命令行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./basic.service.ts";
export * from "./basic.provide.ts";
export * from "./command.service.ts";
export * from "./command.provide.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-compaction`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-compaction";
