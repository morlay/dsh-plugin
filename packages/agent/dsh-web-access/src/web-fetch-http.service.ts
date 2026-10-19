// HTTP 抓取后端：上游 `WebFetchHttpPlugin` 经 `fromCordis` 接管。
import * as WebFetchHttpPlugin from "@deepseek-ai/dsh-web-fetch-http";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Web } from "./contract/web.contract.ts";

@Injectable()
export class WebFetchHttp extends fromCordis(WebFetchHttpPlugin) {
  web = inject(Web);

  protected override async onInit(ctx: Context): Promise<void> {
    // 上游 0.2.2 的 `apply(ctx, config)` 直接读 `ResolvedConfig` 的必填字段（schemastery 的默认值只在
    // 走它自己的 `Config` 解析时才填），本行不走那一步，所以显式给同一组默认值。
    await this.mount(
      ctx,
      {
        maxResponseBytes: 5_000_000,
        maxBodyChars: 100_000,
        timeoutMs: 30_000,
        maxRedirects: 5,
      },
      { web: this.web },
    );
  }
}
