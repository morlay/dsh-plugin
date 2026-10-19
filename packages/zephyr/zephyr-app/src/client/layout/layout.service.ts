import * as LayoutPlugin from "@deepseek-ai/dsh-client-ui-layout/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale } from "../locale/locale.contract.ts";
import { Slots } from "../renderer/slots.contract.ts";
import { Shortcuts } from "../shortcuts/shortcuts.contract.ts";
import { Theme } from "../theme/theme.contract.ts";
import { Layout } from "./layout.contract.ts";

@Injectable()
export class LayoutDefault extends fromCordis(Layout, LayoutPlugin) {
  private readonly slots = inject(Slots);

  private readonly theme = inject(Theme);

  private readonly locale = inject(Locale);

  private readonly shortcuts = inject(Shortcuts);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      theme: this.theme,
      locale: this.locale,
      shortcuts: this.shortcuts,
    });
  }
}
