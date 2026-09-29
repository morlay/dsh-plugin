// Agent Teams：**可选**的一族行，默认关闭（`DSH_AGENT_TEAM=1` 才装）。行住在 `rows.ts` 的 `TEAM_ROWS`
// （与其它工具族同一形态）。本部署的 preset 声明不含这一族（要用团队的人加上游
// `@deepseek-ai/dsh-experimental-agent-team-profile` bundle），这个出口留给别的装配自己取用。
export { AGENT_TEAM_ENV, agentTeamDisabled, TEAM_ROWS } from "./rows.ts";
