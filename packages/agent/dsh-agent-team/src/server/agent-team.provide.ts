import { provide } from "@morlay/zephyr";
import { TeamServiceDefault, ToolAgentTeam } from "./team.service.ts";

// 顺序即依赖：工具行按 `agentTeams` 判断成员身份，服务行必须在前。
export const provideAgentTeam = provide([TeamServiceDefault, ToolAgentTeam]);
