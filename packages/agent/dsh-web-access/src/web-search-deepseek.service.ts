// DeepSeek 搜索后端：上游 `WebSearchDeepseekPlugin` 经 `fromCordis` 接管。
import * as WebSearchDeepseekPlugin from "@deepseek-ai/dsh-web-search-deepseek";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { DeepSeekAuthToken } from "@morlay/dsh-auth";
import { Web } from "./contract/web.contract.ts";

@Injectable()
export class WebSearchDeepseek extends fromCordis(WebSearchDeepseekPlugin) {
  web = inject(Web);

  /**
   * 上游 0.2.3 起这条搜索后端也从 `ctx.deepseekAuth` 取凭据（`inject` 声明里有它）：显式交给它，
   * 装配顺序由这条依赖边定住（`provideAuth()` 要在 `provideWebAccess()` 之前）。
   */
  private readonly deepseekAuth = inject(DeepSeekAuthToken);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { web: this.web, deepseekAuth: this.deepseekAuth });
  }
}
