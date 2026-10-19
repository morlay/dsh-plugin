// workflow 工具（纯实现行，不声明契约）。
import * as ToolWorkflowPlugin from "@deepseek-ai/dsh-tool-workflow";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt as SystemPromptContract } from "@morlay/dsh-agent";
import { WorkflowEngine } from "./index.ts";
import { Tools } from "@morlay/dsh-agent";

@Injectable()
export class ToolWorkflow extends fromCordis(ToolWorkflowPlugin) {
  tools = inject(Tools);

  workflowEngine = inject(WorkflowEngine);

  systemPrompt = inject(SystemPromptContract);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      workflowEngine: this.workflowEngine,
      systemPrompt: this.systemPrompt,
    });
  }
}
