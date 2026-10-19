import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiBrandOfficialPlugin from "@deepseek-ai/dsh-client-ui-brand-official";

@Injectable()
export class UiBrandOfficial extends fromCordis(UiBrandOfficialPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
