import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiToolPlugin from "@deepseek-ai/dsh-client-ui-tool";

@Injectable()
export class UiTool extends fromCordis(UiToolPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
