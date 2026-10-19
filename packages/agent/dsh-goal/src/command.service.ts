import * as CommandGoalPlugin from "@deepseek-ai/dsh-command-goal";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { CommandRegistry } from "@morlay/dsh-command";
import { Goal } from "./contract/goal.contract.ts";

@Injectable()
export class CommandGoal extends fromCordis(CommandGoalPlugin) {
  commands = inject(CommandRegistry);

  goals = inject(Goal);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { commands: this.commands, goals: this.goals });
  }
}
