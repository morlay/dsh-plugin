// DeepSeek LLM API 扩展注册表：上游注册表类经 `fromCordis` 接管。
import DeepSeekLlmApiExtensionRegistry from "@deepseek-ai/dsh-deepseek-llm-api-extensions";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { DeepseekLlmApiExtensions } from "./contract/deepseek-llm-api-extensions.contract.ts";

@Injectable()
export class DeepseekLlmApiExtensionsDefault extends fromCordis(
  DeepseekLlmApiExtensions,
  DeepSeekLlmApiExtensionRegistry,
) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
