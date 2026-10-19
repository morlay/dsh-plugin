// `ui-deliverables` 的 client 半：它在 `apply` 里用 `ctx.connection.fetch.register`，
// 而 `connection.fetch` 由 `remote` 装配时补上——`attachProviders` 是并发的，所以这里等 `remote` 就绪。
import * as UiDeliverablesPlugin from "@deepseek-ai/dsh-client-ui-deliverables";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis, providerContext } from "@morlay/zephyr/compat";

@Injectable()
export class UiDeliverables extends fromCordis(UiDeliverablesPlugin) {
  protected override readonly nativeProvide = true;

  protected async onInit(ctx: Context): Promise<void> {
    const context = providerContext(ctx) as unknown as {
      inject(names: readonly string[], callback: () => void): void;
    };
    await new Promise<void>((resolve) => context.inject(["remote"], resolve));
    await this.mount(ctx);
  }
}
