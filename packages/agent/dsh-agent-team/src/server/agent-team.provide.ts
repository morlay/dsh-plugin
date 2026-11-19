import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { TeamServiceDefault, ToolAgentTeam } from "./team.service.ts";

// 顺序即依赖：工具行按 `agentTeams` 判断成员身份，服务行必须在前。
export const provideAgentTeam = provide([
  TeamServiceDefault,
  ToolAgentTeam,
  // `agentTeams` 这组 descriptor 的**提供者登记**（与 `provideApiSession()` 同形）：
  // 浏览器半的 `ui-agent-team` 按名字读 `remote.agentTeams`，而浏览器里没有全局 remotes 装载——
  // 客户端那半由 `AgentTeamUi` 自己 `$mount` 这一份；这条登记喂的是 dev/preview 的宿主聚合清单
  // （`ClientModulesDefault` 用 `inject.all(RemoteDescriptor)` 聚合后逐个挂）。
  remoteDescriptor(() => import("@deepseek-ai/dsh-agent-team/remote")),
]);
