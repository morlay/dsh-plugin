import * as GoalRoundDriverPlugin from "@deepseek-ai/dsh-goal-round-driver";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AgentDirectory } from "@morlay/dsh-agent";
import { Goal } from "./contract/goal.contract.ts";
import { SessionStore } from "@morlay/dsh-session";

@Injectable()
export class GoalRoundDriver extends fromCordis(GoalRoundDriverPlugin) {
  agents = inject(AgentDirectory);

  goals = inject(Goal);

  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      goals: this.goals,
      sessions: this.sessions,
    });
  }
}
