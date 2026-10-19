// TimeoutPolicy（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as TimeoutPolicyPlugin from "@deepseek-ai/dsh-tool-call-timeout-policy";
import { Tools } from "./tools.contract.ts";

@Injectable()
export class TimeoutPolicy extends fromCordis(TimeoutPolicyPlugin) {
  tools = inject(Tools);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { tools: this.tools });
  }
}
