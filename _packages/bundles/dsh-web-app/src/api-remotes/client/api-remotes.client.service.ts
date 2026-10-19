// `@deepseek-ai/dsh-api-remotes` 是 host 侧插件：把 Remote 的实现接成 gateway 的 forwarded-event
// 源。它依赖 `typertGateway`（上游 `static inject`），所以要显式传进 mount 的依赖表。
import { TypertGateway } from "@morlay/dsh-base/typert";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ApiRemotesPlugin from "@deepseek-ai/dsh-api-remotes";

@Injectable()
export class ApiRemotes extends fromCordis(ApiRemotesPlugin) {
  protected override readonly nativeProvide = true;

  gateway = inject(TypertGateway);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { typertGateway: this.gateway });
  }
}
