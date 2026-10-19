import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ShortcutsPlugin from "@deepseek-ai/dsh-client-shortcuts";
import * as UiShortcutsPlugin from "@deepseek-ai/dsh-client-ui-shortcuts";

@Injectable()
export class Shortcuts extends fromCordis(ShortcutsPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiShortcuts extends fromCordis(UiShortcutsPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
