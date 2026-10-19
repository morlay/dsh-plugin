import CommandRuntime from "@deepseek-ai/dsh-commands";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { CommandRegistry } from "./contract/index.ts";

/** 命令注册表的实现：直接复用上游 `CommandRuntime`（它就是这个注册表）。 */
@Injectable()
export class CommandRegistryDefault extends fromCordis(CommandRegistry, CommandRuntime) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
