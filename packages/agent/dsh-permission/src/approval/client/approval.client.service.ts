import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiApprovalPlugin from "@deepseek-ai/dsh-client-ui-approval";

@Injectable()
export class UiApproval extends fromCordis(UiApprovalPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
