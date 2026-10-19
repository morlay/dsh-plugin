// ToolFs（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolFsPlugin from "@deepseek-ai/dsh-tool-fs";
import { FileSystem } from "@morlay/dsh-fs";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { ToolRegistry } from "@morlay/dsh-agent";
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import { WorkingDirectory } from "@morlay/dsh-working-directory";

@Injectable()
export class ToolFs extends fromCordis(ToolFsPlugin) {
  tools = inject(ToolRegistry);

  fs = inject(FileSystem);

  systemPrompt = inject(SystemPromptContract);

  workingDirectory = inject(WorkingDirectory);

  // 上游在 apply 里读 `ctx.sandboxPolicy` 判定「文件系统是否被约束」：受限时必须显式交进去。
  sandboxPolicy = inject(SandboxPolicy);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      fs: this.fs,
      systemPrompt: this.systemPrompt,
      workingDirectory: this.workingDirectory,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
