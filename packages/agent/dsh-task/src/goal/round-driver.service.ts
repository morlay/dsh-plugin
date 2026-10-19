import * as GoalRoundDriverPlugin from "@deepseek-ai/dsh-goal-round-driver";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Agents } from "@morlay/dsh-agent";
import { Goal } from "@morlay/dsh-task";
import { SessionStore } from "@morlay/dsh-session";

@Injectable()
export class GoalRoundDriver extends fromCordis(GoalRoundDriverPlugin) {
  agents = inject(Agents);

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
