// 系统提示词：上游 `SystemPrompt` 服务类经 `fromCordis` 接管。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SystemPrompt } from "./contract/system-prompt.contract.ts";
import { SystemPrompt as SystemPromptService } from "@deepseek-ai/dsh-system-prompt";

@Injectable()
export class SystemPromptDefault extends fromCordis(SystemPrompt, SystemPromptService) {
  /**
   * 上游的 `[Service.init]` 里就 `sessionProjections.register(...)` 登记准入投影：把注册表显式交进去，
   * 装配序才由这条依赖边定住（上游没在 `static inject` 里声明它，读的是 `this.ctx.sessionProjections`）。
   */
  private readonly sessionProjections = inject(SessionProjectionStore);

  override async onInit(ctx: Context): Promise<void> {
    // 行配置原样交给 `mount`（上游 schema 的默认值由它补）。
    await this.mount(ctx, undefined, { sessionProjections: this.sessionProjections });
  }
}
