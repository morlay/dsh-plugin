import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiJobsPlugin from "@deepseek-ai/dsh-client-ui-jobs";

@Injectable()
export class UiJobs extends fromCordis(UiJobsPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
