// 流程与交付：todo / 计划 / goal / 交付物。
import type { ToolGroup } from "../types.ts";

export const PLAN_GROUP: ToolGroup = {
  key: "plan",
  title: "流程",
  injection: "on-demand",
  guideline: "要在会话里跟踪待办与目标、安排定时提醒、或声明交付物时加载它。",
  lines: [
    {
      when: "todo_write",
      text: "todo_write：多步任务先建清单，并随着进展更新状态。",
    },
    {
      when: ["create_goal", "get_goal", "update_goal"],
      text: "create_goal：长任务跟踪目标进展（配 get_goal 看、update_goal 改）。",
    },
    { when: "present", text: "present：要给用户看的产物，用它声明出来。" },
    {
      when: "exit_plan_mode",
      text: "exit_plan_mode：动手前提交计划（计划模式下只读）；本部署装了计划模式才有这一行。",
    },
    {
      when: ["schedule_create", "schedule_list", "schedule_view", "schedule_edit"],
      text: "定时任务：schedule_create 用 rrule（一行 DTSTART + 一行 RRULE）与 target 指定投递去处，prompt 每次触发时作为用户消息送达；schedule_list 列 Host 全部任务（含别的会话建的，分页），schedule_view 看单个，schedule_edit 按 action 改 / 暂停 / 恢复 / 删除（带 expectedUpdatedAt 才防并发覆盖，删除不撤回已入队的消息）。",
    },
  ],
  drops: ["tool:goal", "tool:schedule"],
  tools: [
    { tool: "todo_write", short: "维护多步任务的待办清单" },
    { tool: "exit_plan_mode", short: "提交计划并请求批准" },
    { tool: "get_goal", short: "查看当前会话目标" },
    { tool: "create_goal", short: "创建会话目标" },
    { tool: "update_goal", short: "更新会话目标状态" },
    { tool: "present", short: "声明交付给用户的产物" },
    { tool: "schedule_create", short: "按 rrule 建定时任务" },
    { tool: "schedule_list", short: "列出全部定时任务" },
    { tool: "schedule_view", short: "按 id 查看一个定时任务" },
    { tool: "schedule_edit", short: "按 id 改 / 暂停 / 删除任务" },
    { tool: "plugin_manager", short: "管理本 profile 的插件与 bundle" },
  ],
};
