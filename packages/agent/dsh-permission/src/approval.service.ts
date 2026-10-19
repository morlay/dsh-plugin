// 用户批准：上游 `ApprovalService` 经 `fromCordis` 接管。
import { ApprovalService } from "@deepseek-ai/dsh-user-approval";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Approval } from "./contract/approval.contract.ts";

@Injectable()
export class ApprovalDefault extends fromCordis(Approval, ApprovalService) {
  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    // 上游 0.2.2 起 `ApprovalService` 在 `[Service.init]` 里读 `sessionProjections` 登记审批投影。
    await this.mount(ctx, undefined, { sessionProjections: this.sessionProjections });
  }
}
