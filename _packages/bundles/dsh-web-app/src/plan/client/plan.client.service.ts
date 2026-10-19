import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiPlanPlugin from "@deepseek-ai/dsh-client-ui-plan";

@Injectable()
export class UiPlan extends fromCordis(UiPlanPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
