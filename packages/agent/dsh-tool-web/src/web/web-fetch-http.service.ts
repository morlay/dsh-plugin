// HTTP 抓取后端：上游 `WebFetchHttpPlugin` 经 `fromCordis` 接管。
import * as WebFetchHttpPlugin from "@deepseek-ai/dsh-web-fetch-http";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Web } from "./web.contract.ts";

@Injectable()
export class WebFetchHttp extends fromCordis(WebFetchHttpPlugin) {
  web = inject(Web);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { web: this.web });
  }
}
