// job 域的包根：契约 + 后台任务注册表行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./endpoint/index.ts";
export * from "./job-registry.service.ts";
export * from "./job-controller.row.ts";
export * from "./server/index.ts";
export * from "./server/tool-jobs.service.ts";

// 与本包契约同名的上游符号：显式导出本包的，覆盖上游那份（TS 显式优先，运行时也只出我们的契约）。
export { JobRegistry } from "./contract/job-registry.contract.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-jobs`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-jobs";
