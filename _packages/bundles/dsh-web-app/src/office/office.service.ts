import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import OfficeToPdfPlugin from "@deepseek-ai/dsh-office-to-pdf";

@Injectable()
export class OfficeToPdf extends fromCordis(OfficeToPdfPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
