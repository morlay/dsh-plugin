// workflow 工具（纯实现行，不声明契约）。
import * as ToolWorkflowPlugin from "@deepseek-ai/dsh-tool-workflow";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { WorkflowEngine } from "@morlay/dsh-base/workflow";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class ToolWorkflow extends fromCordis(ToolWorkflowPlugin) {
  tools = inject(Tools);

  workflowEngine = inject(WorkflowEngine);

  systemPrompt = inject(SystemPrompt);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      workflowEngine: this.workflowEngine,
      systemPrompt: this.systemPrompt,
    });
  }
}
