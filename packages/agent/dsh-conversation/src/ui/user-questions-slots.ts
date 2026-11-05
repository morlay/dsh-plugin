// 会话里的「待回答提问」卡片（上游 `ui-user-questions`）。
import * as UiUserQuestionsPlugin from "@deepseek-ai/dsh-client-ui-user-questions/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-conversation/ui";
import { UiConversation } from "@morlay/dsh-conversation/ui";
import { UiSession } from "@morlay/dsh-conversation/ui";
// 远端身份只从 `./endpoint`（client-safe）取：包根带三个宿主 service，浏览器半引不得。
import { USER_QUESTIONS_REMOTE } from "@morlay/dsh-permission/endpoint";

@Injectable()
export class UserQuestionsSlots extends fromCordis(UiUserQuestionsPlugin) {
  private readonly sessions = inject(SessionController);

  private readonly remote = inject(Remote);

  private readonly uiSession = inject(UiSession);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly uiConversation = inject(UiConversation);

  override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(USER_QUESTIONS_REMOTE);
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      remote: this.remote,
      "remote.userQuestions": this.remote,
      uiSession: this.uiSession,
      slots: this.slots,
      locale: this.locale,
      uiConversation: this.uiConversation,
    });
  }
}
