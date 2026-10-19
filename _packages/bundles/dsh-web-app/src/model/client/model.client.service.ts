import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiModelSelectionPlugin from "@deepseek-ai/dsh-client-ui-model-selection";

@Injectable()
export class UiModelSelection extends fromCordis(UiModelSelectionPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
