// 授权契约：令牌按服务语义命名（上游注册名 `authorization`）。
import type { AuthorizationService } from "@deepseek-ai/dsh-authorization";
import { Injectable } from "@morlay/zephyr";

interface AuthorizationFace {
  readonly registerFlow: AuthorizationService["registerFlow"];
  readonly list: AuthorizationService["list"];
  readonly describe: AuthorizationService["describe"];
  readonly cancel: AuthorizationService["cancel"];
}

@Injectable()
export abstract class Authorization implements AuthorizationFace {
  abstract readonly registerFlow: AuthorizationFace["registerFlow"];

  abstract readonly list: AuthorizationFace["list"];

  abstract readonly describe: AuthorizationFace["describe"];

  abstract readonly cancel: AuthorizationFace["cancel"];
}
