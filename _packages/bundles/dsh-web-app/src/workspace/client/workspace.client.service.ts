import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiWorkspacePlugin from "@deepseek-ai/dsh-client-ui-workspace";

@Injectable()
export class UiWorkspace extends fromCordis(UiWorkspacePlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
