import ShortcutsPlugin from "@deepseek-ai/dsh-client-shortcuts/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale } from "../locale/locale.contract.ts";
import { Shortcuts } from "./shortcuts.contract.ts";

@Injectable()
export class ShortcutsDefault extends fromCordis(Shortcuts, ShortcutsPlugin) {
  private readonly locale = inject(Locale);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { locale: this.locale });
  }
}
