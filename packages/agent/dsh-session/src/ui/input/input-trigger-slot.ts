// 输入区触发器（`ctx.inputTriggers`）+ slash 菜单（`conversation.input.overlay` 的 `slash-menu`）。
//
// 上游 `ui-input-trigger` 的 apply 里既 `ctx.plugin(InputTriggerService)` 又注册菜单 slot——两件事同源，
// 直接装整行（`allowSubplugins` 逐行显式允许），不再拆成两个"服务壳 + 复刻注册"。
import * as UiInputTriggerPlugin from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { InputTriggers } from "./input.token.ts";

@Injectable()
export class InputTriggerSlot extends fromCordis(InputTriggers, UiInputTriggerPlugin) {
  private readonly sessions = inject(SessionController);

  private readonly locale = inject(Locale);

  private readonly slots = inject(Slots);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      locale: this.locale,
      slots: this.slots,
    });
  }
}
