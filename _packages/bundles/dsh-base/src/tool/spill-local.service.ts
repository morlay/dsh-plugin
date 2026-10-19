// SpillLocal（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import LocalSpillStore from "@deepseek-ai/dsh-spill-local";

@Injectable()
export class SpillLocal extends fromCordis(LocalSpillStore, LocalSpillStore) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
