// 凭证契约：令牌按服务语义命名。
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { Injectable } from "@morlay/zephyr";

interface CredentialsFace {
  readonly resolve: CredentialProvider["resolve"];
}

@Injectable()
export abstract class Credentials implements CredentialsFace {
  abstract readonly resolve: CredentialsFace["resolve"];
}
