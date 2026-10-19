import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiChatPlugin from "@deepseek-ai/dsh-client-ui-chat";

@Injectable()
export class UiChat extends fromCordis(UiChatPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
