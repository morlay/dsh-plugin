// gateway 的 client 半：上游 `@deepseek-ai/dsh-api-gateway/client` 的 `apply` 里会 `new ClientRemoteService`，
// 它从 ctx 读 `connection`。`attachProviders` 是并发的，所以这里**等 `connection` 就绪**再 mount。
import * as GatewayClientPlugin from "@deepseek-ai/dsh-api-gateway/client";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis, providerContext } from "@morlay/zephyr/compat";

@Injectable()
export class ClientGateway extends fromCordis(GatewayClientPlugin) {
  protected override readonly nativeProvide = true;

  protected async onInit(ctx: Context): Promise<void> {
    const context = providerContext(ctx) as unknown as {
      inject(names: readonly string[], callback: () => void): void;
    };
    await new Promise<void>((resolve) => context.inject(["connection"], resolve));
    await this.mount(ctx);
  }
}
