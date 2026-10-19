import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiAttachmentPlugin from "@deepseek-ai/dsh-client-ui-attachment";

@Injectable()
export class UiAttachment extends fromCordis(UiAttachmentPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
