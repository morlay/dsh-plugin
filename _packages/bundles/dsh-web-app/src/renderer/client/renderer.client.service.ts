import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiRendererPlugin from "@deepseek-ai/dsh-client-ui-renderer";

@Injectable()
export class UiRenderer extends fromCordis(UiRendererPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
