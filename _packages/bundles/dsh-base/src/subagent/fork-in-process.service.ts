// 同进程 fork provider（纯实现行，不声明契约）。
import * as SubagentForkInProcessPlugin from "@deepseek-ai/dsh-subagent-fork-in-process";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Subagents } from "./subagents.contract.ts";

@Injectable()
export class SubagentForkInProcess extends fromCordis(SubagentForkInProcessPlugin) {
  subagents = inject(Subagents);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { subagents: this.subagents });
  }
}
