import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ResourcesPlugin from "@deepseek-ai/dsh-client-resources";

@Injectable()
export class Resources extends fromCordis(ResourcesPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
