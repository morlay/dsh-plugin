import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiConversationPlugin from "@deepseek-ai/dsh-client-ui-conversation";

@Injectable()
export class UiConversation extends fromCordis(UiConversationPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
