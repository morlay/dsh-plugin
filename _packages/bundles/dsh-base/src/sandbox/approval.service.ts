// 用户批准：上游 `ApprovalService` 经 `fromCordis` 接管。
import { ApprovalService } from "@deepseek-ai/dsh-user-approval";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Approval } from "./approval.contract.ts";

@Injectable()
export class ApprovalDefault extends fromCordis(Approval, ApprovalService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
