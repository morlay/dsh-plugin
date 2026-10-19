// 输入区的一行（上游 `ui-commands` / `ui-reference` / `ui-skill` / `ui-plan`）。
import * as UiPlanPlugin from "@deepseek-ai/dsh-client-ui-plan/client";
import { TYPERT_REMOTE as COMMANDS_REMOTE } from "@deepseek-ai/dsh-commands/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Resources, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { UiConversation } from "@morlay/dsh-session/ui";
import { SidebarRight } from "@morlay/dsh-session/ui";
import { SidebarRightTabs } from "@morlay/zephyr-app/client";

@Injectable()
export class PlanSlots extends fromCordis(UiPlanPlugin) {
  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  private readonly sessions = inject(SessionController);

  private readonly locale = inject(Locale);

  private readonly uiConversation = inject(UiConversation);

  private readonly resources = inject(Resources);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly sidebarRightTabs = inject(SidebarRightTabs);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(COMMANDS_REMOTE);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      remote: this.remote,
      "remote.commands": this.remote,
      "remote.session": this.remote,
      sessions: this.sessions,
      locale: this.locale,
      uiConversation: this.uiConversation,
      resources: this.resources,
      sidebarRight: this.sidebarRight,
      sidebarRightTabs: this.sidebarRightTabs,
    });
  }
}
