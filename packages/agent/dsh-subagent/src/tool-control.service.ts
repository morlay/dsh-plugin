// subagent 控制工具（纯实现行，不声明契约）。
import * as ToolSubagentControlPlugin from "@deepseek-ai/dsh-tool-subagent-control";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AgentDirectory, ToolRegistry } from "@morlay/dsh-agent";
import { SubagentRegistry } from "./contract/subagent-registry.contract.ts";

@Injectable()
export class ToolSubagentControl extends fromCordis(ToolSubagentControlPlugin) {
  tools = inject(ToolRegistry);

  subagents = inject(SubagentRegistry);

  agents = inject(AgentDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      subagents: this.subagents,
      agents: this.agents,
    });
  }
}
