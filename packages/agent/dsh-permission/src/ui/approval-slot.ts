// 上游审批卡片（client 行）：`approval/request` 事件 → 会话里的批准/拒绝面。
//
// inject：`sessions` / `remote` / `uiSession` / `slots` / `locale`。审批请求靠 `remote.$on('approval/request')`
// 到达；宿主还没有这个事件源时它只是不弹卡片，不影响装配。
import * as UiApprovalPlugin from "@deepseek-ai/dsh-client-ui-approval/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { UiSession } from "@morlay/dsh-session/ui";

@Injectable()
export class ApprovalSlot extends fromCordis(UiApprovalPlugin) {
  private readonly sessions = inject(SessionController);

  private readonly remote = inject(Remote);

  private readonly uiSession = inject(UiSession);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      remote: this.remote,
      uiSession: this.uiSession,
      slots: this.slots,
      locale: this.locale,
    });
  }
}
