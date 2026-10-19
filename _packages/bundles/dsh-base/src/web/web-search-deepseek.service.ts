// DeepSeek 搜索后端：上游 `WebSearchDeepseekPlugin` 经 `fromCordis` 接管。
import * as WebSearchDeepseekPlugin from "@deepseek-ai/dsh-web-search-deepseek";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Web } from "./web.contract.ts";

@Injectable()
export class WebSearchDeepseek extends fromCordis(WebSearchDeepseekPlugin) {
  web = inject(Web);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { web: this.web });
  }
}
