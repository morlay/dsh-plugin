import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiAgentPresetPlugin from "@deepseek-ai/dsh-client-ui-agent-preset";

@Injectable()
export class UiAgentPreset extends fromCordis(UiAgentPresetPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
