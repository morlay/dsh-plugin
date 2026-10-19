import CommandRuntime from "@deepseek-ai/dsh-commands";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Commands } from "./commands.contract.ts";

@Injectable()
export class CommandsDefault extends fromCordis(Commands, CommandRuntime) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
