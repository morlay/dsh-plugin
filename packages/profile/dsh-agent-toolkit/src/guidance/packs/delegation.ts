/** 派发（子代理与脚本编排）。 */
import type { ToolPack } from "../types.ts";

export const DELEGATION_PACK: ToolPack = {
  family: "delegation",
  tools: [
    { tool: "subagent", short: "派发子代理执行任务" },
    { tool: "subagent_fork", short: "派发继承当前上下文的子代理" },
    { tool: "list_subagent_models", short: "查看子代理可用的模型" },
    { tool: "workflow", short: "用脚本编排多个子代理" },
  ],
};
