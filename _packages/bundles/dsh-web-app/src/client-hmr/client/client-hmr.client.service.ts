import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ClientHmrPlugin from "@deepseek-ai/dsh-client-hmr";

@Injectable()
export class ClientHmr extends fromCordis(ClientHmrPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
