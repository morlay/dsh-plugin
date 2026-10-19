// ToolBash（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolBashPlugin from "@deepseek-ai/dsh-tool-bash";
import { ShellEnv, ShellExecutor, WorkingDirectory } from "@morlay/dsh-base/sandbox";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class ToolBash extends fromCordis(ToolBashPlugin) {
  tools = inject(Tools);

  shell = inject(ShellExecutor);

  systemPrompt = inject(SystemPrompt);

  shellEnv = inject(ShellEnv);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      shell: this.shell,
      systemPrompt: this.systemPrompt,
      shellEnv: this.shellEnv,
      workingDirectory: this.workingDirectory,
    });
  }
}
