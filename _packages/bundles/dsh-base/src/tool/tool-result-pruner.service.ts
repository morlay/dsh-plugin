// ToolResultPruner（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import ToolResultPrunerService from "@deepseek-ai/dsh-compaction-tool-result-pruner";
import { TokenMeter } from "@morlay/dsh-base/token-meter";

@Injectable()
export class ToolResultPruner extends fromCordis(ToolResultPrunerService, ToolResultPrunerService) {
  tokenMeter = inject(TokenMeter);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { tokenMeter: this.tokenMeter });
  }
}
