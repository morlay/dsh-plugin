import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import SubagentModelSelectionSettingsPlugin from "@deepseek-ai/dsh-tool-subagent/model-selection-settings";

@Injectable()
export class SubagentModelSelectionSettings extends fromCordis(SubagentModelSelectionSettingsPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
