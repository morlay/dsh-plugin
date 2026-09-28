/**
 * Agent Teams：**可选**的一族行，默认关闭（`DSH_AGENT_TEAM=1` 才装）。
 *
 * 这套是上游实验能力（roster / 消息 / 共享任务 + 模型侧工具 + Web UI），上游自带
 * `@deepseek-ai/dsh-experimental-agent-team-profile` bundle 做同样的事：把直接派发那几行换掉、
 * 插入这三行。这里复用同一套换法，做成"本包的一个子出口 + 默认关闭的族组"。
 *
 * 行本身住在 [`TEAM_ROWS`](./rows.ts)（`rows.ts` 的 `team` 族，与其它工具族同一形态）。本部署的 preset
 * 声明**不含**这一族（要用团队的人加上游那份 bundle）；这个出口留给别的装配自己取用。
 */
export { AGENT_TEAM_ENV, agentTeamDisabled, TEAM_ROWS } from "./rows.ts";
