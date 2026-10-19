import * as GoalRoundDriverPlugin from "@deepseek-ai/dsh-goal-round-driver";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Agents } from "@morlay/dsh-base/agent";
import { Goal } from "@morlay/dsh-base/goal";
import { SessionStore } from "@morlay/dsh-base/session";

@Injectable()
export class GoalRoundDriver extends fromCordis(GoalRoundDriverPlugin) {
  agents = inject(Agents);

  goals = inject(Goal);

  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      agents: this.agents,
      goals: this.goals,
      sessions: this.sessions,
    });
  }
}
