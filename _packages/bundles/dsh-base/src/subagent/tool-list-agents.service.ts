// 列出子代理的工具（纯实现行，不声明契约）。
import * as ToolSubagentListAgentsPlugin from "@deepseek-ai/dsh-tool-subagent-control/list-agents";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Agents } from "@morlay/dsh-base/agent";
import { Tools } from "@morlay/dsh-base/tool";
import { Subagents } from "./subagents.contract.ts";

@Injectable()
export class ToolSubagentListAgents extends fromCordis(ToolSubagentListAgentsPlugin) {
  tools = inject(Tools);

  subagents = inject(Subagents);

  agents = inject(Agents);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      tools: this.tools,
      subagents: this.subagents,
      agents: this.agents,
    });
  }
}
