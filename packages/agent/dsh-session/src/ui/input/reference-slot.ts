// 输入区的一行（上游 `ui-commands` / `ui-reference` / `ui-skill` / `ui-plan`）。
import * as UiReferencePlugin from "@deepseek-ai/dsh-client-ui-reference/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "../session-controller.contract.ts";
import { UiConversation } from "../conversation/conversation.token.ts";
import { SidebarRight } from "../ports.ts";
import { InputTriggers } from "../input/input.token.ts";

@Injectable()
export class ReferenceSlot extends fromCordis(UiReferencePlugin) {
  private readonly inputTriggers = inject(InputTriggers);

  private readonly locale = inject(Locale);

  private readonly sessions = inject(SessionController);

  private readonly remote = inject(Remote);

  private readonly sidebarRight = inject(SidebarRight);

  private readonly slots = inject(Slots);

  private readonly uiConversation = inject(UiConversation);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      inputTriggers: this.inputTriggers,
      locale: this.locale,
      sessions: this.sessions,
      remote: this.remote,
      "remote.fileReferences": this.remote,
      "remote.sessionReferenceResolver": this.remote,
      sidebarRight: this.sidebarRight,
      slots: this.slots,
      uiConversation: this.uiConversation,
    });
  }
}
