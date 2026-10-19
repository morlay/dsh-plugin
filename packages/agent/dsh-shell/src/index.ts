// shell 域的包根：契约 + 行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./shell-env.service.ts";
export * from "./subprocess.service.ts";
export * from "./shell.provide.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-shell-env`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-shell-env";
