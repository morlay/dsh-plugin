// 沙箱策略：上游 `SandboxPolicyService` 经 `fromCordis` 接管。
import { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SandboxPolicy } from "./contract/sandbox-policy.contract.ts";

@Injectable()
export class SandboxPolicyDefault extends fromCordis(SandboxPolicy, SandboxPolicyService) {
  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessionProjections: this.sessionProjections });
  }
}
