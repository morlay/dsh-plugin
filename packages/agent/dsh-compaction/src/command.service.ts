import * as CommandCompactPlugin from "@deepseek-ai/dsh-command-compact";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { CommandRegistry } from "@morlay/dsh-command";
import { CompactionBasic } from "./basic.service.ts";

@Injectable()
export class CommandCompact extends fromCordis(CommandCompactPlugin) {
  commands = inject(CommandRegistry);

  compaction = inject(CompactionBasic);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { commands: this.commands, compaction: this.compaction });
  }
}
