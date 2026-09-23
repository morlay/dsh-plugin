/** 流程与交付：todo / 计划 / goal / 交付物。 */
import type { GroupPack } from "../types.ts";

export const FLOW_GROUP: GroupPack = {
  family: "group-flow",
  group: {
    key: "flow",
    title: "流程",
    skillDescription: "要在会话里跟踪待办与目标、或声明交付物时加载它。",
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
    ],
    // 计划模式可选：本部署禁用了 `planning` 行，工具不存在时忽略这一行。
    injection: "on-demand",
    drops: ["tool:goal"],
    tools: ["todo_write", "exit_plan_mode", "get_goal", "create_goal", "update_goal", "present"],
  },
};
