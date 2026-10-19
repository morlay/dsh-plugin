// ToolFs（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolFsPlugin from "@deepseek-ai/dsh-tool-fs";
import { FileSystem } from "../fs/fs.contract.ts";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { Tools } from "@morlay/dsh-agent";
import { WorkingDirectory } from "../working-directory.contract.ts";

@Injectable()
export class ToolFs extends fromCordis(ToolFsPlugin) {
  tools = inject(Tools);

  fs = inject(FileSystem);

  systemPrompt = inject(SystemPromptContract);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      fs: this.fs,
      systemPrompt: this.systemPrompt,
      workingDirectory: this.workingDirectory,
    });
  }
}
