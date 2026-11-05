// 系统提示词：上游 `SystemPrompt` 服务类经 `fromCordis` 接管。
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt } from "@morlay/dsh-agent";
import { SystemPrompt as SystemPromptService } from "@deepseek-ai/dsh-system-prompt";

@Injectable()
export class SystemPromptDefault extends fromCordis(SystemPrompt, SystemPromptService) {
  override async onInit(ctx: Context): Promise<void> {
    // 行配置原样交给 `mount`（上游 schema 的默认值由它补）。
    await this.mount(ctx);
  }
}
