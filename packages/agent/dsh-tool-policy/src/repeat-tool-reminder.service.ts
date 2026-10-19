// RepeatToolReminder（工具/策略实现行）。
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as RepeatToolReminderPlugin from "@deepseek-ai/dsh-repeat-tool-reminder";

@Injectable()
export class RepeatToolReminder extends fromCordis(RepeatToolReminderPlugin) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
