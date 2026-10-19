// token-meter seam 的契约：令牌按服务语义命名（上游注册名 `tokenMeter`）。
import type TokenMeterService from "@deepseek-ai/dsh-token-meter";
import { Injectable } from "@morlay/zephyr";

interface TokenMeterFace {
  readonly measure: TokenMeterService["measure"];
}

/** 用量折叠：按会话累计 token。 */
@Injectable()
export abstract class TokenMeter implements TokenMeterFace {
  abstract readonly measure: TokenMeterFace["measure"];
}
