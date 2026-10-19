// 文件观察策略（纯实现行，不声明契约）。
import * as FsObservationPolicyPlugin from "@deepseek-ai/dsh-fs-observation-policy";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class FsObservationPolicy extends fromCordis(FsObservationPolicyPlugin) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
