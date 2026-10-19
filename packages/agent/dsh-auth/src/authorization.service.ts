// 授权：上游 `AuthorizationService` 经 `fromCordis` 接管。
import { AuthorizationService } from "@deepseek-ai/dsh-authorization";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Authorization } from "./authorization.contract.ts";
import { Credentials } from "./credentials.contract.ts";

@Injectable()
export class AuthorizationDefault extends fromCordis(Authorization, AuthorizationService) {
  credentials = inject(Credentials);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { credentials: this.credentials });
  }
}
