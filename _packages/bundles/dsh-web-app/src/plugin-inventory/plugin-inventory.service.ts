import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import PluginInventoryPlugin from "@deepseek-ai/dsh-host-plugin-inventory";

@Injectable()
export class PluginInventory extends fromCordis(PluginInventoryPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
