// ToolBash（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolBashPlugin from "@deepseek-ai/dsh-tool-bash";
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import { WorkingDirectory } from "@morlay/dsh-working-directory";
import { ShellEnv } from "@morlay/dsh-shell";
import { ShellExecutor } from "@morlay/dsh-shell";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { ToolRegistry } from "@morlay/dsh-agent";

@Injectable()
export class ToolBash extends fromCordis(ToolBashPlugin) {
  tools = inject(ToolRegistry);

  shell = inject(ShellExecutor);

  systemPrompt = inject(SystemPromptContract);

  shellEnv = inject(ShellEnv);

  workingDirectory = inject(WorkingDirectory);

  // 上游在 apply 里读 `ctx.sandboxPolicy` 判定「执行器是否被约束」：受限时必须显式交进去。
  sandboxPolicy = inject(SandboxPolicy);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      shell: this.shell,
      systemPrompt: this.systemPrompt,
      shellEnv: this.shellEnv,
      workingDirectory: this.workingDirectory,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
