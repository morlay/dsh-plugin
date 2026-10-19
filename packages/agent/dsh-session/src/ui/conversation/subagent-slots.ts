// 会话里的子代理卡片与右侧入口（上游 `ui-subagent`）。
import * as UiSubagentPlugin from "@deepseek-ai/dsh-client-ui-subagent/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "../session-controller.contract.ts";
import { UiWorkspace } from "@morlay/dsh-workspace/ui";
import { SidebarRight } from "../ports.ts";

@Injectable()
export class SubagentSlots extends fromCordis(UiSubagentPlugin) {
  private readonly sessions = inject(SessionController);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly sidebarRight = inject(SidebarRight);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      uiWorkspace: this.uiWorkspace,
      slots: this.slots,
      locale: this.locale,
      sidebarRight: this.sidebarRight,
    });
  }
}
