// LLM 重试（纯实现行，不声明契约）。
import * as LlmRetryPlugin from "@deepseek-ai/dsh-llm-retry";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjections } from "@morlay/dsh-session";
import { Agents } from "./agents.contract.ts";

@Injectable()
export class LlmRetry extends fromCordis(LlmRetryPlugin) {
  agents = inject(Agents);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    // 两个字段都是**依赖**（上游 `inject` 声明的名字），走第三参数。
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessionProjections: this.sessionProjections,
    });
  }
}
