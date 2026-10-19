// ToolBash（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolBashPlugin from "@deepseek-ai/dsh-tool-bash";
import { WorkingDirectory } from "../working-directory.contract.ts";
import { ShellEnv } from "../sandbox/shell-env.contract.ts";
import { ShellExecutor } from "../sandbox/shell.contract.ts";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { Tools } from "@morlay/dsh-agent";

@Injectable()
export class ToolBash extends fromCordis(ToolBashPlugin) {
  tools = inject(Tools);

  shell = inject(ShellExecutor);

  systemPrompt = inject(SystemPromptContract);

  shellEnv = inject(ShellEnv);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      shell: this.shell,
      systemPrompt: this.systemPrompt,
      shellEnv: this.shellEnv,
      workingDirectory: this.workingDirectory,
    });
  }
}
