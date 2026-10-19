// pi-ai LLM provider（纯实现行，不声明契约）。
import * as LlmPiAiPlugin from "@deepseek-ai/dsh-llm-pi-ai";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "./llm.contract.ts";

@Injectable()
export class LlmPiAi extends fromCordis(LlmPiAiPlugin) {
  llm = inject(Llm);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { llm: this.llm });
  }
}
