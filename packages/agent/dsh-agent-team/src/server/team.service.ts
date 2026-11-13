// Agent Teams：把上游 `TeamService`（服务名 `agentTeams`）与它那套团队工具装进本仓装配。
//
// 上游是 experimental 包，我们不 fork——直接 `fromCordis` 接管，换实现时只改这一处。
//
// 两半的分工：
// - `TeamService` 是 cordis `Service` 子类（`super(ctx, 'agentTeams')`），由适配行 `mount` 时 `new` 出来；
// - `tool-agent-team` 是**函数插件**（`export function apply`），注册 `spawn_teammate` / `send_message` /
//   `list_agents` / `wait_agent` / `interrupt_agent` / `team_task_*` 那一套。
//
// 工具**按会话**注册：上游 `apply` 在 `agent/created` 上判断这个 agent 是不是 Team 成员，是才装工具。
import TeamService from "@deepseek-ai/dsh-agent-team";
import * as ToolAgentTeamPlugin from "@deepseek-ai/dsh-tool-agent-team";
import { AgentDirectory, SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SubagentRegistry } from "@morlay/dsh-agent";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

/**
 * `agentTeams` 服务：上游 `TeamService` 经 `fromCordis` 接管。
 *
 * 五件依赖都由装配面显式交进去（`mount` 的 deps）：上游按 `this.ctx.<name>` 严格读，
 * 名字对不上时读到 `undefined` 然后在运行期炸。
 */
@Injectable()
export class TeamServiceDefault extends fromCordis(TeamService) {
  private readonly agents = inject(AgentDirectory);

  private readonly sessions = inject(SessionStore);

  private readonly persistence = inject(SessionPersistence);

  private readonly projections = inject(SessionProjectionStore);

  private readonly subagents = inject(SubagentRegistry);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessions: this.sessions,
      sessionPersistence: this.persistence,
      sessionProjections: this.projections,
      subagents: this.subagents,
    });
  }
}

/**
 * 团队工具行：上游 `tool-agent-team` 经 `fromCordis` 接管。
 *
 * 四件依赖里 `agentTeams` 是**上一条适配行的契约面**（装配顺序保证它已经 mount 过，
 * 注入拿到的是上游实例而不是适配行空壳）；`tools` / `systemPrompt` 是本仓契约。
 */
@Injectable()
export class ToolAgentTeam extends fromCordis(ToolAgentTeamPlugin) {
  private readonly agents = inject(AgentDirectory);

  private readonly teams = inject(TeamServiceDefault);

  private readonly tools = inject(ToolRegistry);

  private readonly systemPrompt = inject(SystemPrompt);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      agentTeams: this.teams,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
    });
  }
}
