import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiPermissionPlugin from "@deepseek-ai/dsh-client-ui-permission-presets";

@Injectable()
export class UiPermission extends fromCordis(UiPermissionPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
