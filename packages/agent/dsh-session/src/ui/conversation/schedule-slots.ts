// 计划任务面板（上游 `ui-schedule`）：会话里的任务卡片 + 右侧「计划任务」标签页。
//
// 它 inject 了 `conversation`（会话控制器），但 apply 里只往 slot 注册（`conversation.chat.turnTail`、
// `conversation.session.header.utilities`、`sidebar.right.pane.tab`），**不读** `ctx.conversation` 的成员。
// 这里给它 `ConversationSlots` 提供的独立实例。
import * as UiSchedulePlugin from "@deepseek-ai/dsh-client-ui-schedule/client";
import { TYPERT_REMOTE as SCHEDULE_REMOTE } from "@deepseek-ai/dsh-schedule/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, RemoteAccess, Slots } from "@morlay/zephyr-app/client";
import { WorkspaceController } from "@morlay/dsh-workspace/ui";
import { SessionController } from "../session-controller.contract.ts";
import { Conversation } from "./conversation.token.ts";
import { UiConversation } from "./conversation.token.ts";
import { SidebarRight } from "../ports.ts";
import { SidebarRightTabs } from "../ports.ts";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";

@Injectable()
export class ScheduleSlots extends fromCordis(UiSchedulePlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly conversation = inject(Conversation);

  private readonly uiConversation = inject(UiConversation);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly sessions = inject(SessionController);

  private readonly workspaces = inject(WorkspaceController);

  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly remoteAccess = inject(RemoteAccess);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(SCHEDULE_REMOTE);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      "remote.schedule": this.remote,
      conversation: this.conversation,
      uiConversation: this.uiConversation,
      uiWorkspace: this.uiWorkspace,
      sessions: this.sessions,
      workspaces: this.workspaces,
      sidebarRightTabs: this.sidebarRightTabs,
      sidebarRight: this.sidebarRight,
      remoteAccess: this.remoteAccess,
    });
  }
}
