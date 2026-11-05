// job 域的包根：契约 + 后台任务注册表行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./endpoint/index.ts";
export * from "./job-registry.service.ts";
export * from "./job-controller.service.ts";
export * from "./server/index.ts";
export * from "./server/tool-jobs.service.ts";

// 与本包契约同名的上游符号：显式导出本包的，覆盖上游那份（TS 显式优先，运行时也只出我们的契约）。
export { JobRegistry } from "./contract/job-registry.contract.ts";

// 上游 `@deepseek-ai/dsh-jobs` **一个符号都不透传**：本包的 `JobRegistry` 是自己的契约（`./contract`），
// 远程面（组契约 / 端点名 / 请求响应形状）在 `./endpoint`。上游独有的 `JobId` 品牌本仓没有消费方——
// 要用的人直接引上游包，别从门面上透传。
