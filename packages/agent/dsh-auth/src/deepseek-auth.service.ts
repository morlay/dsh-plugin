// DeepSeek 认证：上游 `DeepSeekAuth` 服务类经 `fromCordis` 接管。
//
// 0.2.3 起 DeepSeek 的两条模型路由（API key / 平台账号）都从这里取凭据（`ctx.deepseekAuth`），
// 不再各自读 credentials：这一行就是那个面。
import { DeepSeekAuth } from "@deepseek-ai/dsh-deepseek-auth";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Credentials } from "@morlay/zephyr-app";
import { DeepSeekAuthToken } from "./contract/deepseek-auth.contract.ts";

@Injectable()
export class DeepSeekAuthDefault extends fromCordis(DeepSeekAuthToken, DeepSeekAuth) {
  private readonly credentials = inject(Credentials);

  override async onInit(ctx: Context): Promise<void> {
    // 上游构造里只 `super(ctx, 'deepseekAuth')`；`credentials` 与账号服务在它自己 `ctx.get` 里读。
    await this.mount(ctx, undefined, { credentials: this.credentials });
  }
}
