/** 协作编排：Agent Teams（可选能力，见 `agent-team` 出口）。 */
import type { GroupPack } from "../types.ts";

export const TEAM_GROUP: GroupPack = {
  family: "group-team",
  group: {
    key: "team",
    title: "协作编排",
    skillDescription: "装了 Agent Teams、要把工作分给队友并协同完成时加载它。",
    lines: [
      {
        when: "spawn_teammate",
        text: "spawn_teammate：派发队友（可指定后台与模型）；装了 Agent Teams 时用这套替代 subagent。",
      },
      {
        when: "wait_agent",
        text: "wait_agent：等队友回复（只观察调用之后的变更，不唤醒）；没有其他人会产生变更时立即返回，唤醒或超时后重新 list。",
      },
      {
        when: ["team_task_create", "team_task_list", "team_task_get", "team_task_update"],
        text: "team_task_list：共享任务板按 list → get → 用当前 revision claim → 做事 → complete 走；任务就绪不会自动唤醒负责人。",
      },
      {
        when: "spawn_teammate",
        text: "只在用户明确要求时才招募队友；Lead 必须等齐所需队友后才能给出最终答复。",
      },
    ],
    injection: "on-demand",
    drops: ["team:policy"],
    tools: [
      "spawn_teammate",
      "wait_agent",
      "team_task_create",
      "team_task_list",
      "team_task_get",
      "team_task_update",
    ],
    // `send_message` / `list_agents` / `interrupt_agent` 也出现在派发组（子代理控制行提供同名工具），
    // 所以本组的成立判据只认团队插件独有的入口——否则没装 Agent Teams 的会话也会列出它。
    requires: ["spawn_teammate", "team_task_create", "wait_agent"],
  },
};
