// McpResources（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import McpResourceRuntime from "@deepseek-ai/dsh-mcp-resources";
import { Tools } from "@morlay/dsh-agent";

@Injectable()
export class McpResources extends fromCordis(McpResourceRuntime, McpResourceRuntime) {
  tools = inject(Tools);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { tools: this.tools });
  }
}
