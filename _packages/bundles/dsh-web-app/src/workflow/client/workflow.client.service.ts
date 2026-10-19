import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiWorkflowRunPlugin from "@deepseek-ai/dsh-client-ui-workflow-run";

@Injectable()
export class UiWorkflowRun extends fromCordis(UiWorkflowRunPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
