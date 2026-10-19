// LLM 运行时：上游 `LlmRuntime` 经 `fromCordis` 接管。
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "./llm.contract.ts";

@Injectable()
export class LlmDefault extends fromCordis(Llm, LlmRuntime) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
