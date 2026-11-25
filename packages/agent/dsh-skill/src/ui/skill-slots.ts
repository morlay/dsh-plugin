// 技能（上游 `ui-skill`）：输入区 `/` 的技能源 + 会话里的技能行 + 右侧技能面板。
import * as UiSkillPlugin from "@deepseek-ai/dsh-client-ui-skill/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";
import { skillsGroupName } from "@morlay/dsh-skill/endpoint";
import { Locale, Remote, SidebarRight, Slots } from "@morlay/zephyr-app/client";
import { InputTriggers, UiConversation } from "@morlay/dsh-conversation/contract";
import { SessionController } from "@morlay/dsh-session/endpoint";

@Injectable()
export class SkillSlots extends fromCordis(UiSkillPlugin) {
  private readonly inputTriggers = inject(InputTriggers);

  // 会话目录：别的域只认会话域的契约（`sessions`），不反向依赖对话聚合层。
  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly uiConversation = inject(UiConversation);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      inputTriggers: this.inputTriggers,
      sessions: this.sessions,
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      [remoteNamespaceKey(skillsGroupName())]: this.remote,
      sidebarRight: this.sidebarRight,
      uiConversation: this.uiConversation,
    });
  }
}
