// ToolGoal（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolGoalPlugin from "@deepseek-ai/dsh-tool-goal";
import { Agents, SystemPrompt } from "@morlay/dsh-base/agent";
import { Goal } from "@morlay/dsh-base/goal";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class ToolGoal extends fromCordis(ToolGoalPlugin) {
  agents = inject(Agents);

  goals = inject(Goal);

  tools = inject(Tools);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      agents: this.agents,
      goals: this.goals,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
