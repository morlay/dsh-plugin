import CommandRuntime from "@deepseek-ai/dsh-commands";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { CommandRegistry } from "./contract/index.ts";

/**
 * 命令注册表的实现：直接复用上游 `CommandRuntime`（它就是这个注册表）。
 *
 * 两个名字各有出处，**互不干扰**：
 * - 上游按 `ctx.inject(['commands'])` 找它（`permission-presets` 就这样注册 `/permission`）——
 *   这条由 `mount` 的**双注册**满足：上游自己的 `provide`/`Service` 名字同时落到本行的 cordis ctx；
 * - 我们自己的代码按令牌 `CommandRegistry` 注入它——这条由 `fromCordis(契约, 实现)` 绑定。
 *
 * 所以不需要"别名契约"：一个实现兑现一个契约，另一个名字走上游自己的注册通道。
 */
@Injectable()
export class CommandRegistryDefault extends fromCordis(CommandRegistry, CommandRuntime) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
