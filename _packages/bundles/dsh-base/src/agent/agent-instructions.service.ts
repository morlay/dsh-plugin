// agent 指令（纯实现行，不声明契约）。
import * as AgentInstructionsPlugin from "@deepseek-ai/dsh-agent-instructions";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WorkingDirectory } from "@morlay/dsh-base/sandbox";
import { SessionProjections } from "@morlay/dsh-base/session-projection";

@Injectable()
export class AgentInstructions extends fromCordis(AgentInstructionsPlugin) {
  sessionProjections = inject(SessionProjections);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      sessionProjections: this.sessionProjections,
      workingDirectory: this.workingDirectory,
    });
  }
}
