/** 派发：子代理与脚本编排。 */
import type { GroupPack } from "../types.ts";

export const DELEGATION_GROUP: GroupPack = {
  family: "group-delegation",
  group: {
    key: "delegation",
    title: "派发",
    skillDescription: "要把工作分给子代理、或编排多代理流程时加载它。",
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
    ],
    injection: "on-demand",
    drops: ["tool:subagent", "tool:subagent_fork", "tool:workflow"],
    tools: [
      "subagent",
      "subagent_fork",
      "list_subagent_models",
      "workflow",
      "list_agents",
      "send_message",
      "interrupt_agent",
    ],
  },
};
