// sandbox 域的包根：契约 + 行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./sandbox.service.ts";
export * from "./sandbox-policy.service.ts";
export * from "./bash-sandbox.service.ts";
export * from "./fs-sandbox.service.ts";
export * from "./fs-observation-policy.service.ts";
export * from "./workspace-files.service.ts";
export * from "./workspace-files.provide.ts";
export * from "./sandbox.provide.ts";

// 与本包契约同名的上游符号：显式导出本包的，覆盖上游那份（TS 显式优先，运行时也只出我们的契约）。
export { SandboxPolicy } from "./contract/sandbox-policy.contract.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-sandbox-policy`，从本包取。
export * from "@deepseek-ai/dsh-sandbox-policy";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-sandbox`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-sandbox";
