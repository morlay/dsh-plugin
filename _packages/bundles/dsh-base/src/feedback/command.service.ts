import { Commands } from "@morlay/dsh-base/commands";
import * as CommandFeedbackPlugin from "@deepseek-ai/dsh-command-feedback";
import { CommandRuntime } from "@deepseek-ai/dsh-commands";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class CommandFeedback extends fromCordis(CommandFeedbackPlugin) {
  commands = inject(Commands);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { commands: this.commands });
  }
}
