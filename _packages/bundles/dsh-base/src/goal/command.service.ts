import * as CommandGoalPlugin from "@deepseek-ai/dsh-command-goal";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Commands } from "@morlay/dsh-base/commands";
import { Goal } from "@morlay/dsh-base/goal";

@Injectable()
export class CommandGoal extends fromCordis(CommandGoalPlugin) {
  commands = inject(Commands);

  goals = inject(Goal);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { commands: this.commands, goals: this.goals });
  }
}
