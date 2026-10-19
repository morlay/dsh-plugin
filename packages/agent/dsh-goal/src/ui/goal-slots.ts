// 会话里的「目标进度」卡片（上游 `ui-goal`）。
import * as UiGoalPlugin from "@deepseek-ai/dsh-client-ui-goal/client";
import { TYPERT_REMOTE as GOALS_REMOTE } from "@deepseek-ai/dsh-goal/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { UiConversation } from "@morlay/dsh-session/ui";

@Injectable()
export class GoalSlots extends fromCordis(UiGoalPlugin) {
  private readonly slots = inject(Slots);

  private readonly sessions = inject(SessionController);

  private readonly remote = inject(Remote);

  private readonly locale = inject(Locale);

  private readonly uiConversation = inject(UiConversation);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(GOALS_REMOTE);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      sessions: this.sessions,
      remote: this.remote,
      "remote.goals": this.remote,
      locale: this.locale,
      uiConversation: this.uiConversation,
    });
  }
}
