import GoalService from "@deepseek-ai/dsh-goal";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Goal } from "../goal.contract.ts";
import { Agents } from "@morlay/dsh-agent";
import { SessionProjections } from "@morlay/dsh-session";

@Injectable()
export class GoalDefault extends fromCordis(Goal, GoalService) {
  agents = inject(Agents);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessionProjections: this.sessionProjections,
    });
  }
}
