// Agent Teams 的浏览器半：上游 `client-ui-agent-team` 经 `fromCordis` 接管。
//
// 它做三件事：注册 `agent-team` 字典、往 `conversation.session.header.actions` 挂一个 Team 动作
// （成员 roster 与任务板面板由它自己的 `TeamAction` 渲染）、把**模型菜单里的「启用智能体团队协作」开关**
// 注册进 `conversation.input.model.options`。**不重写组件**——上游那份照用。
//
// 它按名字读 `locale` / `slots` / `remote`（+ `remote.agentTeams`）。
//
// **`remote.agentTeams` 要自己挂**：浏览器里没有全局的 remotes 装载，每个域各自 `$mount` 自己那份
// `TYPERT_REMOTE`（同 `dsh-workspace` 的「工作区文件组」、本包 `session-reference-remote`）。
// 少了这一步，上游的 `ctx.inject(['remote','remote.agentTeams'], …)` 永远停在待激活——开关静默不出现，
// 且没有任何报错（那整块注册都在那个 scope 里）。
import { TYPERT_REMOTE as AGENT_TEAM_REMOTE } from "@deepseek-ai/dsh-agent-team/remote";
import * as ClientUiAgentTeam from "@deepseek-ai/dsh-client-ui-agent-team/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";

/** 团队动作行（浏览器半）。 */
@Injectable()
export class AgentTeamUi extends fromCordis(ClientUiAgentTeam) {
  private readonly remote = inject(Remote);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  override async onInit(ctx: Context): Promise<void> {
    // 先挂面再装行：上游的 `ctx.inject(['remote','remote.agentTeams'])` 等这个名字，先挂上才当场成立。
    const dispose = await this.remote.$mount(AGENT_TEAM_REMOTE);
    ctx.effect(() => dispose);
    await this.mount(ctx, undefined, {
      remote: this.remote,
      slots: this.slots,
      locale: this.locale,
    });
  }
}
