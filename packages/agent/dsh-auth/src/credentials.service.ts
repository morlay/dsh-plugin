// 凭证：上游 `LocalCredentialProvider` 经 `fromCordis` 接管。
import { CredentialProvider, credentialRef } from "@deepseek-ai/dsh-credentials";
import { LocalCredentialProvider } from "@deepseek-ai/dsh-credentials-local";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { join } from "node:path";
import { fromCordis } from "@morlay/zephyr/compat";
import { Credentials } from "@morlay/zephyr-app";

@Injectable()
export class CredentialsDefault extends fromCordis(Credentials, LocalCredentialProvider) {
  appEnv = inject(AppEnv);

  override async onInit(ctx: Context): Promise<void> {
    // 凭据文件跟随 `AppEnv.dataDir`（显式配置），不读全局 home（macOS 的 Application Support 在沙箱里只读）。
    await this.mount(ctx, { path: join(this.appEnv.values.dataDir, ".credentials.yaml") });
  }
}

// 凭证 seam 的引用名与解析接口只在这里透出：能力包依赖它取 key，不再直接 import 上游包。
export { credentialRef, type CredentialProvider };
