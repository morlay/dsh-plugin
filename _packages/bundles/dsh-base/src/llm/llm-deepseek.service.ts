// DeepSeek API key provider（纯实现行，不声明契约）。
import * as LlmDeepseekPlugin from "@deepseek-ai/dsh-llm-deepseek-api-key";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "./llm.contract.ts";

@Injectable()
export class LlmDeepseek extends fromCordis(LlmDeepseekPlugin) {
  llm = inject(Llm);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { llm: this.llm });
  }
}
