// 插件包清单行（纯实现行，不声明契约）。
import * as PackageInventoryPlugin from "@deepseek-ai/dsh-plugin-package-inventory-deepseek";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Agents } from "@morlay/dsh-base/agent";
import { DeepseekLlmApiExtensions } from "@morlay/dsh-base/llm";

@Injectable()
export class PluginPackageInventoryDeepseek extends fromCordis(PackageInventoryPlugin) {
  agents = inject(Agents);

  deepseekLlmApiExtensions = inject(DeepseekLlmApiExtensions);

  loader = inject.optional(Loader);

  protected override async onInit(ctx: Context): Promise<void> {
    if (this.loader === undefined) return;
    await this.mount(ctx, { enabled: true });
  }
}
