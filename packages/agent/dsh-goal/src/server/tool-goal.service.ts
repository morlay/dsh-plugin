// ToolGoal（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolGoalPlugin from "@deepseek-ai/dsh-tool-goal";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { Goal } from "../contract/goal.contract.ts";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { ToolRegistry } from "@morlay/dsh-agent";

@Injectable()
export class ToolGoal extends fromCordis(ToolGoalPlugin) {
  agents = inject(AgentDirectory);

  goals = inject(Goal);

  tools = inject(ToolRegistry);

  systemPrompt = inject(SystemPromptContract);

  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      goals: this.goals,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
