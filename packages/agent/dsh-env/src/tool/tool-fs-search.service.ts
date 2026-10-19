// ToolFsSearch（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolFsSearchPlugin from "@deepseek-ai/dsh-tool-fs-search";
import { Subprocess } from "../sandbox/subprocess.contract.ts";
import { WorkingDirectory } from "../working-directory.contract.ts";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { Tools } from "@morlay/dsh-agent";

@Injectable()
export class ToolFsSearch extends fromCordis(ToolFsSearchPlugin) {
  tools = inject(Tools);

  systemPrompt = inject(SystemPromptContract);

  subprocess = inject(Subprocess);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      subprocess: this.subprocess,
      workingDirectory: this.workingDirectory,
    });
  }
}
