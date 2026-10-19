// 会话里的密钥打码（上游 `ui-secret-mask`）。
import * as UiSecretMaskPlugin from "@deepseek-ai/dsh-client-ui-secret-mask/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Slots } from "@morlay/zephyr-app/client";
import { UiConversation } from "./conversation.token.ts";

@Injectable()
export class SecretMaskSlot extends fromCordis(UiSecretMaskPlugin) {
  private readonly locale = inject(Locale);

  private readonly slots = inject(Slots);

  private readonly uiConversation = inject(UiConversation);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      locale: this.locale,
      slots: this.slots,
      uiConversation: this.uiConversation,
    });
  }
}
