// 默认模型：上游 `AgentDefaultModelConfig` 经 `fromCordis` 接管。
import AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AgentDefaultModel } from "./agent-default-model.contract.ts";

@Injectable()
export class AgentDefaultModelDefault extends fromCordis(AgentDefaultModel, AgentDefaultModelConfig) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
