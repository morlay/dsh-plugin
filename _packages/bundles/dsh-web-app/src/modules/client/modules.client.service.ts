import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ModulesPlugin from "@deepseek-ai/dsh-client-modules/client";

@Injectable()
export class Modules extends fromCordis({ name: "dsh-client-modules", apply: ModulesPlugin.apply, inject: ModulesPlugin.inject }) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
