// subagent 的**宿主半**（`@morlay/dsh-subagent/server`）：wire 实现。
export { SubagentsEndpointDefault } from "./subagents-endpoint.ts";
export { provideSubagent } from "./subagent.provide.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-subagent`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-subagent";
