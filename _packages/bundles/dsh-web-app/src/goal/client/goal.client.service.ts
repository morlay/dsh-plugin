import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiGoalPlugin from "@deepseek-ai/dsh-client-ui-goal";

@Injectable()
export class UiGoal extends fromCordis(UiGoalPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
