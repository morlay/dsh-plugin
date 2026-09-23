/**
 * Agent Teams：**可选**的一组行，默认关闭（`DSH_AGENT_TEAM=1` 才装）。
 *
 * 这套是上游实验能力（roster / 消息 / 共享任务 + 模型侧工具 + Web UI），上游自带
 * `@deepseek-ai/dsh-experimental-agent-team-profile` bundle 做同样的事：把直接派发那几行换掉、
 * 插入这三行。这里复用同一套换法，只是做成"本包的一个子出口 + 默认关闭的组"，于是它随本包的行清单
 * 一起被引用，不需要单独装一个 bundle。
 *
 * 与 {@link TOOLKIT_ROWS} 的关系：直接派发那几行（`tool-subagent` / `subagent_fork` / 控制行）在团队
 * 开启时让位（`rows.ts` 的 `directDelegationDisabled()`），两者不会同时装。
 */
import { jsExpr } from "./js-expr.ts";
import { agentTeamDisabled, group, row, type PresetRow } from "./rows.ts";

/**
 * agent-team 那一组行（默认关闭）。
 *
 * 默认关闭走 `!!js`：装配期求值 `process.env.DSH_AGENT_TEAM !== '1'`，所以同一个产物在需要时打开
 * （部署里给这个环境变量即可），不必重新生成 preset。
 * @returns 一行 `cordis:group`，组内是上游那三行。
 */
export function agentTeamRows(): readonly PresetRow[] {
  return [
    group(
      "agent-team",
      [
        row("experimental-agent-team", {
          id: "agent-team",
          config: {
            maxMembers: 8,
            maxTasks: 256,
            maxPendingMessagesPerMember: 64,
            maxMessageBytes: 65_536,
            disposalTimeoutMs: 5_000,
          },
        }),
        row("experimental-tool-agent-team", {
          id: "tool-agent-team",
          config: { freshProvider: "spawn", forkProvider: "fork" },
        }),
        row("experimental-client-ui-agent-team", { id: "ui-agent-team" }),
      ],
      { disabled: agentTeamDisabled() },
    ),
  ];
}

export { AGENT_TEAM_ENV } from "./rows.ts";
export { jsExpr };
