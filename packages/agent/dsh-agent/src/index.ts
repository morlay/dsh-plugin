// agent 的主面：**核心**（跨包必引的契约 + 装配模块）。
//
// 子 domain（`./tool` 的工具行、`./subagent`、`./workflow`、`./commands`）各自有出口；
// 入口不聚合一切。
export * from "./agents.contract.ts";
export * from "./agents.service.ts";
export * from "./system-prompt.contract.ts";
export * from "./system-prompt.service.ts";
export * from "./agent-default-model.contract.ts";
export * from "./agent-default-model.service.ts";
export * from "./agent-loop.contract.ts";
export * from "./agent-loop.service.ts";
export * from "./llm-retry.service.ts";
export * from "./llm.contract.ts";
export * from "./llm.service.ts";
export * from "./llm.module.ts";
export * from "./tools.contract.ts";
export * from "./tools.service.ts";
export * from "./agent.module.ts";
