import WebRuntime from "@deepseek-ai/dsh-web";
export { WebRuntime };
import * as WebSearchDeepseekPlugin from "@deepseek-ai/dsh-web-search-deepseek";
import * as WebFetchHttpPlugin from "@deepseek-ai/dsh-web-fetch-http";
import { Injectable, inject, InjectionToken, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Web } from "./web.contract.ts";

// `web` seam 的契约（provider 接口、请求/结果形状、错误类型）只在这里透出：
// 能力包依赖它写后端，不再直接 import 上游包。
export { WebError } from "@deepseek-ai/dsh-web";
export { Web } from "./web.contract.ts";
export type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from "@deepseek-ai/dsh-web";

// 能力包的 HTTP 执行器：装配里没提供就用全局 fetch（测试、代理可替换）。
export const HttpFetch = new InjectionToken<typeof fetch>("httpFetch");

@Injectable()
export class WebDefault extends fromCordis(Web, WebRuntime) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
