// agent 注册表：上游 `AgentRegistry` 经 `fromCordis` 接管。
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Agents } from "./agents.contract.ts";

@Injectable()
export class AgentsDefault extends fromCordis(Agents, AgentRegistry) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
