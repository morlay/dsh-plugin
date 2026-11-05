// ptc 域的包根：契约 + 运行时行 + 执行器行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./ptc-runtime.service.ts";
export * from "./tool-executor.service.ts";
export * from "./ptc.provide.ts";
export { apply } from "@deepseek-ai/dsh-tool-executor-ptc";
