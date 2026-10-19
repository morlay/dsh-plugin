// SpillPolicy（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as SpillPolicyPlugin from "@deepseek-ai/dsh-spill-policy";
import { Tools } from "@morlay/dsh-agent";

@Injectable()
export class SpillPolicy extends fromCordis(SpillPolicyPlugin) {
  tools = inject(Tools);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { tools: this.tools });
  }
}
