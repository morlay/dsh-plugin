// agent-team 的包根：两个默认实现（都是上游的适配行）。
//
// 本包**没有自己的契约**——`agentTeams` 服务由上游 `TeamService` 声明，工具行是上游的函数插件；
// 所以这里只有实现，装配函数在 `./server`、浏览器半在 `./ui`。
export { TeamServiceDefault, ToolAgentTeam } from "./server/team.service.ts";
