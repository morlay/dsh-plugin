// McpResources（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import McpResourceRuntime from "@deepseek-ai/dsh-mcp-resources";
import { ToolRegistry } from "./index.ts";
import { AgentScoped } from "./contract/index.ts";

@AgentScoped()
@Injectable()
export class McpResources extends fromCordis(McpResourceRuntime, McpResourceRuntime) {
  tools = inject(ToolRegistry);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { tools: this.tools });
  }
}
