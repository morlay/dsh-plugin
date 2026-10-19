// TimeoutPolicy（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as TimeoutPolicyPlugin from "@deepseek-ai/dsh-tool-call-timeout-policy";
import { ToolRegistry } from "@morlay/dsh-agent";

@Injectable()
export class TimeoutPolicy extends fromCordis(TimeoutPolicyPlugin) {
  tools = inject(ToolRegistry);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { tools: this.tools });
  }
}
