// dsh-plan-mode 的**宿主半**：宿主机面的装配函数 + wire 端点实现。
export { providePlanMode } from "./plan-mode.provide.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-plan-mode`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-plan-mode";
