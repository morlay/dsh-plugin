// subagent 控制工具（纯实现行，不声明契约）。
import * as ToolSubagentControlPlugin from "@deepseek-ai/dsh-tool-subagent-control";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Tools } from "@morlay/dsh-base/tool";
import { Subagents } from "./subagents.contract.ts";

@Injectable()
export class ToolSubagentControl extends fromCordis(ToolSubagentControlPlugin) {
  tools = inject(Tools);

  subagents = inject(Subagents);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { tools: this.tools, subagents: this.subagents });
  }
}
