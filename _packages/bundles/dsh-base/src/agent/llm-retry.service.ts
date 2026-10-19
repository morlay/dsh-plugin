// LLM 重试（纯实现行，不声明契约）。
import * as LlmRetryPlugin from "@deepseek-ai/dsh-llm-retry";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import { Agents } from "./agents.contract.ts";

@Injectable()
export class LlmRetry extends fromCordis(LlmRetryPlugin) {
  agents = inject(Agents);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      agents: this.agents,
      sessionProjections: this.sessionProjections,
    });
  }
}
