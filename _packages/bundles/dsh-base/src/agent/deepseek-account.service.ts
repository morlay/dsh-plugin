// 平台账号：上游 `PlatformAccount` 经 `fromCordis` 接管。
import PlatformAccount from "@deepseek-ai/dsh-deepseek-account-platform";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Authorization } from "./authorization.contract.ts";
import { Credentials } from "./credentials.contract.ts";
import { DeepseekAccount } from "./deepseek-account.contract.ts";

@Injectable()
export class DeepseekAccountDefault extends fromCordis(DeepseekAccount, PlatformAccount) {
  credentials = inject(Credentials);

  authorization = inject(Authorization);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      credentials: this.credentials,
      authorization: this.authorization,
    });
  }
}
