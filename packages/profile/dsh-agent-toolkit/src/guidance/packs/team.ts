/** Agent Teams（可选能力，见 agent-team 出口）。 */
import type { ToolPack } from "../types.ts";

export const TEAM_PACK: ToolPack = {
  family: "team",
  tools: [
  { tool: "spawn_teammate", short: "招募一个队友" },
  { tool: "send_message", short: "给队友发消息" },
  { tool: "list_agents", short: "列出可协作的代理" },
  { tool: "wait_agent", short: "等待队友回复" },
  { tool: "interrupt_agent", short: "打断某个队友" },
  { tool: "team_task_create", short: "创建共享任务" },
  { tool: "team_task_list", short: "列出共享任务" },
  { tool: "team_task_get", short: "读取共享任务" },
  { tool: "team_task_update", short: "更新共享任务状态" },
  ],
};
