import WebRuntime from "@deepseek-ai/dsh-web";
export { WebRuntime };
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Web } from "./contract/web.contract.ts";

// `web` seam 的契约（provider 接口、请求/结果形状、错误类型）只在这里透出：
// 能力包依赖它写后端，不再直接 import 上游包。
export { WebError } from "@deepseek-ai/dsh-web";
export { Web } from "./contract/web.contract.ts";
export type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from "@deepseek-ai/dsh-web";

@Injectable()
export class WebDefault extends fromCordis(Web, WebRuntime) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
