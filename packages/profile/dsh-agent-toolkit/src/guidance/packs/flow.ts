/** 流程与交付。 */
import type { ToolPack } from "../types.ts";

export const FLOW_PACK: ToolPack = {
  family: "flow",
  tools: [
    { tool: "todo_write", short: "维护多步任务的待办清单" },
    { tool: "exit_plan_mode", short: "提交计划并请求批准" },
    { tool: "get_goal", short: "查看当前会话目标" },
    { tool: "create_goal", short: "创建会话目标" },
    { tool: "update_goal", short: "更新会话目标状态" },
    { tool: "present", short: "声明交付给用户的产物" },
  ],
};
