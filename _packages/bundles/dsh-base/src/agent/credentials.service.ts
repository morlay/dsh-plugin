// 凭证：上游 `LocalCredentialProvider` 经 `fromCordis` 接管。
import { CredentialProvider, credentialRef } from "@deepseek-ai/dsh-credentials";
import { LocalCredentialProvider } from "@deepseek-ai/dsh-credentials-local";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Credentials } from "./credentials.contract.ts";

@Injectable()
export class CredentialsDefault extends fromCordis(Credentials, LocalCredentialProvider) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

// 凭证 seam 的引用名与解析接口只在这里透出：能力包依赖它取 key，不再直接 import 上游包。
export { credentialRef, type CredentialProvider };
