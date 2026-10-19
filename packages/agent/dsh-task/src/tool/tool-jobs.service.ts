// ToolJobs（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolJobsPlugin from "@deepseek-ai/dsh-tool-jobs";
import { Jobs } from "@morlay/dsh-task/jobs";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { Tools } from "@morlay/dsh-agent";

@Injectable()
export class ToolJobs extends fromCordis(ToolJobsPlugin) {
  tools = inject(Tools);

  jobs = inject(Jobs);

  systemPrompt = inject(SystemPromptContract);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      jobs: this.jobs,
      systemPrompt: this.systemPrompt,
    });
  }
}
