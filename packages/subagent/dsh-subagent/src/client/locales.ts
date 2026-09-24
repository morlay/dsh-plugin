/** 本包在配置页上的字段文案（命名空间 `settings.subagent`）。 */

export const zh = {
  maxDepth: "最大递归深度",
  maxDepthHint:
    "限制 Agent 创建子代理的递归层级：「0」禁用子代理，「1」只允许主代理创建子代理，更大的值放开到该层数。某个工具自带深度上限时以该工具的设置为准。",
  maxActiveSubagents: "子代理并行数量上限",
  maxActiveSubagentsHint:
    "同一主代理下，所有递归层级同时存活的子代理总数（主代理不计入）。达到上限时，新的启动请求会被拒绝。",
} as const;

export const en: Record<keyof typeof zh, string> = {
  maxDepth: "Maximum recursion depth",
  maxDepthHint:
    "How deep agents may delegate: 0 disables subagents, 1 lets only the main agent delegate, larger values open that many levels. A tool's own limit wins.",
  maxActiveSubagents: "Live subagent cap",
  maxActiveSubagentsHint:
    "Live subagents across all levels under one main agent (the main agent is not counted). Further starts are refused at the cap.",
};

export type SubagentFieldLocaleKey = keyof typeof zh;
