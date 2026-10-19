// 同进程 spawn provider（纯实现行，不声明契约）。
import * as SubagentSpawnInProcessPlugin from "@deepseek-ai/dsh-subagent-spawn-in-process";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Subagents } from "./subagents.contract.ts";

@Injectable()
export class SubagentSpawnInProcess extends fromCordis(SubagentSpawnInProcessPlugin) {
  subagents = inject(Subagents);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { subagents: this.subagents });
  }
}
