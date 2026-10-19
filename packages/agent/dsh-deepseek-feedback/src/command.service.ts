import { Commands } from "@morlay/dsh-agent/commands";
import * as CommandFeedbackPlugin from "@deepseek-ai/dsh-command-feedback";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class CommandFeedback extends fromCordis(CommandFeedbackPlugin) {
  commands = inject(Commands);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { commands: this.commands });
  }
}
