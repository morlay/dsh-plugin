// subagent 运行时：上游 `SubagentRuntime` 经 `fromCordis` 接管。
import SubagentRuntime from "@deepseek-ai/dsh-subagent";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WorkingDirectory } from "@morlay/dsh-base/sandbox";
import { Subagents } from "./subagents.contract.ts";

@Injectable()
export class SubagentsDefault extends fromCordis(Subagents, SubagentRuntime) {
  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { workingDirectory: this.workingDirectory });
  }
}
