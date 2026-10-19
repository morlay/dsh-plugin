import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiReferencePlugin from "@deepseek-ai/dsh-client-ui-reference";

@Injectable()
export class UiReference extends fromCordis(UiReferencePlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
