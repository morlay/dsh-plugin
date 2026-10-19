import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiOpenInAppPlugin from "@deepseek-ai/dsh-client-ui-open-in-app";

@Injectable()
export class UiOpenInApp extends fromCordis(UiOpenInAppPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
