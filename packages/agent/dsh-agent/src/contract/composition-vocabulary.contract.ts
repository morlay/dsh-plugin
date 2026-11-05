// agent 的**组合与作用域词汇**：preset（组合面）与 scope（作用域工具）。
//
// 上游分别是 `@deepseek-ai/dsh-agent-preset-registry` 与 `@deepseek-ai/dsh-scope`；两者都服务 agent 域。
export type { PresetDefinition } from "@deepseek-ai/dsh-agent-preset-registry";
export { default as AgentPresets } from "@deepseek-ai/dsh-agent-preset-registry";
export { bindScopeParent, createScope, scopeOf } from "@deepseek-ai/dsh-scope";
