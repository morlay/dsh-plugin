// ToolFsSearch（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolFsSearchPlugin from "@deepseek-ai/dsh-tool-fs-search";
import { Subprocess, WorkingDirectory } from "@morlay/dsh-base/sandbox";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class ToolFsSearch extends fromCordis(ToolFsSearchPlugin) {
  tools = inject(Tools);

  systemPrompt = inject(SystemPrompt);

  subprocess = inject(Subprocess);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      subprocess: this.subprocess,
      workingDirectory: this.workingDirectory,
    });
  }
}
