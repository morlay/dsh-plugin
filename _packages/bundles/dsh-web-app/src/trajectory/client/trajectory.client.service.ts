import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiTrajectoryPlugin from "@deepseek-ai/dsh-client-ui-trajectory";

@Injectable()
export class UiTrajectory extends fromCordis(UiTrajectoryPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
