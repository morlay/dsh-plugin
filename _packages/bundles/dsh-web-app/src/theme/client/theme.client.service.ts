import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiThemePlugin from "@deepseek-ai/dsh-client-ui-theme";

@Injectable()
export class UiTheme extends fromCordis(UiThemePlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
