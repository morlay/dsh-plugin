// 注意：下面这个包根的 `apply()` 是空的（node 半），装它不注册任何东西——审批卡片由
// `approval-slot.ts` 的 `/client` 行提供。为什么先留着，见债务「`provideApproval()` 装的是空 apply」。
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiApprovalPlugin from "@deepseek-ai/dsh-client-ui-approval";

@Injectable()
export class UiApproval extends fromCordis(UiApprovalPlugin) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
