// agent 指令（纯实现行，不声明契约）。
import * as AgentInstructionsPlugin from "@deepseek-ai/dsh-agent-instructions";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WorkingDirectory } from "@morlay/dsh-working-directory";
import { AgentDirectory } from "@morlay/dsh-agent";

@Injectable()
export class AgentInstruction extends fromCordis(AgentInstructionsPlugin) {
  agents = inject(AgentDirectory);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      workingDirectory: this.workingDirectory,
    });
  }
}
