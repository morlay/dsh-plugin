// 流程与交付：todo / 计划 / goal / 交付物。
import type { GroupPack } from "../types.ts";

export const FLOW_GROUP: GroupPack = {
  family: "group-flow",
  group: {
    key: "flow",
    title: "流程",
    skillDescription: "要在会话里跟踪待办与目标、安排定时提醒、或声明交付物时加载它。",
    lines: [
      { when: "todo_write", text: "todo_write：多步任务先建清单，并随着进展更新状态。" },
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
      "todo_write",
      "exit_plan_mode",
      "get_goal",
      "create_goal",
      "update_goal",
      "present",
      "schedule_create",
      "schedule_list",
      "schedule_view",
      "schedule_edit",
    ],
  },
};
