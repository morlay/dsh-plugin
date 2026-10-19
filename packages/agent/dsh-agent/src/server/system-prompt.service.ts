// 系统提示词：上游 `SystemPrompt` 服务类经 `fromCordis` 接管。
import { SystemPrompt as SystemPromptService } from "@deepseek-ai/dsh-system-prompt";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt } from "../contract/system-prompt.contract.ts";

@Injectable()
export class SystemPromptDefault extends fromCordis(SystemPrompt, SystemPromptService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
