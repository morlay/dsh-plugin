// 会话里的轨迹视图（上游 `ui-trajectory`）。
import * as UiTrajectoryPlugin from "@deepseek-ai/dsh-client-ui-trajectory/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "../session-controller.contract.ts";
import { UiSession } from "../ui-session.token.ts";
import { UiConversation } from "./conversation.token.ts";

@Injectable()
export class TrajectorySlot extends fromCordis(UiTrajectoryPlugin) {
  private readonly slots = inject(Slots);

  private readonly sessions = inject(SessionController);

  private readonly uiSession = inject(UiSession);

  private readonly uiConversation = inject(UiConversation);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      sessions: this.sessions,
      uiSession: this.uiSession,
      uiConversation: this.uiConversation,
      locale: this.locale,
      remote: this.remote,
      // 带点的名字按**字面键**给出（同 `chat-slots` 的 `remote.session`）。
      "remote.toolResults": this.remote,
    });
  }
}
