// 技能（上游 `ui-skill`）：输入区 `/` 的技能源 + 会话里的技能行 + 右侧技能面板。
import * as UiSkillPlugin from "@deepseek-ai/dsh-client-ui-skill/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import {
  InputTriggers,
  SessionController,
  SidebarRight,
  UiConversation,
} from "@morlay/dsh-session/ui";

@Injectable()
export class SkillSlots extends fromCordis(UiSkillPlugin) {
  private readonly inputTriggers = inject(InputTriggers);

  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly uiConversation = inject(UiConversation);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      inputTriggers: this.inputTriggers,
      sessions: this.sessions,
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      "remote.skills": this.remote,
      sidebarRight: this.sidebarRight,
      uiConversation: this.uiConversation,
    });
  }
}
