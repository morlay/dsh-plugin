// Agent Teams 的浏览器半：上游 `client-ui-agent-team` 经 `fromCordis` 接管。
//
// 它做两件事：注册 `agent-team` 字典、往 `conversation.session.header.actions` 挂一个 Team 动作
// （成员 roster 与任务板面板由它自己的 `TeamAction` 渲染）。**不重写组件**——上游那份照用。
//
// 它按名字读四件：`sessions` / `uiWorkspace` / `slots` / `locale`。全是本仓已有的契约面。
import * as ClientUiAgentTeam from "@deepseek-ai/dsh-client-ui-agent-team/client";
import { SessionController, UiSession } from "@morlay/dsh-conversation/ui";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Slots } from "@morlay/zephyr-app/client";

/** 团队动作行（浏览器半）。 */
@Injectable()
export class AgentTeamUi extends fromCordis(ClientUiAgentTeam) {
  private readonly sessions = inject(SessionController);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly uiSession = inject(UiSession);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      uiWorkspace: this.uiWorkspace,
      slots: this.slots,
      locale: this.locale,
    });
  }
}
