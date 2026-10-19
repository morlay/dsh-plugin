import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiSubagentPlugin from "@deepseek-ai/dsh-client-ui-subagent";

@Injectable()
export class UiSubagent extends fromCordis(UiSubagentPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
