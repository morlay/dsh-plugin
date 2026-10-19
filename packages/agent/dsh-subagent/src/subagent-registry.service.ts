// subagent 运行时：上游 `SubagentRuntime` 经 `fromCordis` 接管。
import SubagentRuntime from "@deepseek-ai/dsh-subagent";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { WorkingDirectory } from "@morlay/dsh-working-directory";
import { SubagentRegistry } from "./contract/subagent-registry.contract.ts";

@Injectable()
export class SubagentRegistryDefault extends fromCordis(SubagentRegistry, SubagentRuntime) {
  workingDirectory = inject(WorkingDirectory);

  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      workingDirectory: this.workingDirectory,
      sessionProjections: this.sessionProjections,
    });
  }
}
