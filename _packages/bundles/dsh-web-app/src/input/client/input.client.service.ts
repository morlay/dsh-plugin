import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiInputTriggerPlugin from "@deepseek-ai/dsh-client-ui-input-trigger";

@Injectable()
export class UiInputTrigger extends fromCordis(UiInputTriggerPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
