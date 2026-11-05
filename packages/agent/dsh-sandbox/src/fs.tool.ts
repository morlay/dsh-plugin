// `read` / `write` / `edit` 工具行：把文件系统的能力交给上游 `tool-fs`。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolFsPlugin from "@deepseek-ai/dsh-tool-fs";
import { FileSystem } from "@morlay/dsh-fs";
import { SystemPrompt, ToolRegistry, WorkingDirectory } from "@morlay/dsh-agent";
import { SandboxPolicy } from "./contract/index.ts";

@Injectable()
export class ToolFs extends fromCordis(ToolFsPlugin) {
  tools = inject(ToolRegistry);

  fs = inject(FileSystem);

  systemPrompt = inject(SystemPrompt);

  workingDirectory = inject(WorkingDirectory);

  // 上游在 apply 里读 `ctx.sandboxPolicy` 判定「文件系统是否被约束」：受限时必须显式交进去。
  sandboxPolicy = inject(SandboxPolicy);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      fs: this.fs,
      systemPrompt: this.systemPrompt,
      workingDirectory: this.workingDirectory,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
