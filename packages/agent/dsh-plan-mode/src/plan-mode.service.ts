import PlanModeController from "@deepseek-ai/dsh-plan-mode";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { PlanMode } from "./contract/plan-mode.contract.ts";
import { AgentDirectory, SystemPrompt } from "@morlay/dsh-agent";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { ToolRegistry } from "@morlay/dsh-agent";

@Injectable()
export class PlanModeDefault extends fromCordis(PlanMode, PlanModeController) {
  agents = inject(AgentDirectory);

  tools = inject(ToolRegistry);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
