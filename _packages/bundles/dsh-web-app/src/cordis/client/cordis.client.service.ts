import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiCordisPlugin from "@deepseek-ai/dsh-client-ui-cordis";

@Injectable()
export class UiCordis extends fromCordis(UiCordisPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
