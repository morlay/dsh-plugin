// ToolFs（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolFsPlugin from "@deepseek-ai/dsh-tool-fs";
import { FileSystem } from "@morlay/dsh-base/fs";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { Tools } from "./tools.contract.ts";
import { WorkingDirectory } from "@morlay/dsh-base/sandbox";

@Injectable()
export class ToolFs extends fromCordis(ToolFsPlugin) {
  tools = inject(Tools);

  fs = inject(FileSystem);

  systemPrompt = inject(SystemPrompt);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      fs: this.fs,
      systemPrompt: this.systemPrompt,
      workingDirectory: this.workingDirectory,
    });
  }
}
