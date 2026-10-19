import * as CommandFeedbackPlugin from "@deepseek-ai/dsh-command-feedback";
import { CommandRegistry } from "@morlay/dsh-command";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class CommandFeedback extends fromCordis(CommandFeedbackPlugin) {
  commands = inject(CommandRegistry);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { commands: this.commands });
  }
}
