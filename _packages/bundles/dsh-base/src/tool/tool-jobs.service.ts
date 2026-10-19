// ToolJobs（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolJobsPlugin from "@deepseek-ai/dsh-tool-jobs";
import { Jobs } from "@morlay/dsh-base/runtime";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class ToolJobs extends fromCordis(ToolJobsPlugin) {
  tools = inject(Tools);

  jobs = inject(Jobs);

  systemPrompt = inject(SystemPrompt);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      jobs: this.jobs,
      systemPrompt: this.systemPrompt,
    });
  }
}
