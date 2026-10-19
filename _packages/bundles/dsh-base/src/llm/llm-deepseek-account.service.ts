// DeepSeek 账号 LLM provider（纯实现行，不声明契约）。
import * as LlmDeepseekAccountPlugin from "@deepseek-ai/dsh-llm-deepseek-account";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "./llm.contract.ts";

@Injectable()
export class LlmDeepseekAccount extends fromCordis(LlmDeepseekAccountPlugin) {
  llm = inject(Llm);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { llm: this.llm });
  }
}
