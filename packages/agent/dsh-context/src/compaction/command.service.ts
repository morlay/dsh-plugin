import * as CommandCompactPlugin from "@deepseek-ai/dsh-command-compact";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Commands } from "@morlay/dsh-agent/commands";
import { CompactionBasic } from "./basic.service.ts";

@Injectable()
export class CommandCompact extends fromCordis(CommandCompactPlugin) {
  commands = inject(Commands);

  compaction = inject(CompactionBasic);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { commands: this.commands, compaction: this.compaction });
  }
}
