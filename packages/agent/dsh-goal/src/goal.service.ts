import GoalService from "@deepseek-ai/dsh-goal";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Goal } from "./contract/goal.contract.ts";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionProjectionStore } from "@morlay/dsh-session";

@Injectable()
export class GoalDefault extends fromCordis(Goal, GoalService) {
  agents = inject(AgentDirectory);

  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessionProjections: this.sessionProjections,
    });
  }
}
