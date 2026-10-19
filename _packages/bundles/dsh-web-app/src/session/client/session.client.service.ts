import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiSessionPlugin from "@deepseek-ai/dsh-client-ui-session";

@Injectable()
export class UiSession extends fromCordis(UiSessionPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
