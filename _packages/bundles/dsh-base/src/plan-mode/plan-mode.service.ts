import PlanModeController from "@deepseek-ai/dsh-plan-mode";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { PlanMode } from "./plan-mode.contract.ts";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import { Tools } from "@morlay/dsh-base/tool";

@Injectable()
export class PlanModeDefault extends fromCordis(PlanMode, PlanModeController) {
  tools = inject(Tools);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
