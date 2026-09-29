// 流程与交付。
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
    { tool: "schedule_create", short: "在本会话里建定时提醒" },
    { tool: "schedule_list", short: "列出本会话的活动提醒" },
    { tool: "schedule_update", short: "原地改一个提醒" },
    { tool: "schedule_delete", short: "删除一个提醒" },
  ],
};
