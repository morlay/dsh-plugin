// 多代理协作：子代理、工作流与 Agent Teams。
import type { ToolGroup } from "../types.ts";

export const SWARM_GROUP: ToolGroup = {
  key: "swarm",
  title: "多代理协作",
  injection: "on-demand",
  guideline: "要把工作分给子代理或队友、并协同完成时加载它。",
  lines: [
    {
      when: ["subagent", "subagent_fork"],
      text: "派发时把约束写进任务说明：工作目录、要遵守的 AGENTS.md、验收标准。",
    },
    { when: "subagent", text: "subagent：派发子代理（默认后台，独立任务可以一次起多路）。" },
    { when: "subagent_fork", text: "subagent_fork：需要继承当前上下文时用它派发。" },
    { when: "list_subagent_models", text: "list_subagent_models：查子代理可用的模型。" },
    {
      when: "workflow",
      text: "workflow：跨多代理的大规模编排（写一段 JavaScript 脚本），仅当用户明确要求时用；一两处委派直接用派发工具。",
    },
    { when: "list_agents", text: "list_agents：看自己名下的代理在跑什么。" },
    {
      when: "send_message",
      text: "send_message：给子代理发消息；它只回执送达、不返回回答，失败即没送到。",
    },
    {
      when: "interrupt_agent",
      text: "interrupt_agent：打断某个后台代理的当前回合（只停这一回合，它自己还能继续接活）。",
    },

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
  drops: ["team:policy"],
  tools: [
    { tool: "subagent", short: "派发子代理执行任务" },
    { tool: "subagent_fork", short: "派发继承当前上下文的子代理" },
    { tool: "list_subagent_models", short: "查看子代理可用的模型" },
    { tool: "workflow", short: "用脚本编排多个子代理" },
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
