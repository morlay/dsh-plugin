// token-meter seam 的契约：令牌按服务语义命名（上游注册名 `tokenMeter`）。
import type TokenMeterService from "@deepseek-ai/dsh-token-meter";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/** 契约面：上游 `TokenMeter` 的**全部**公开成员（用量折叠与消息估算）。 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type TokenMeterCovered = AssertTrue<AssertCovered<TokenMeterService, TokenMeter>>;

@Injectable()
export abstract class TokenMeter {
  abstract readonly measure: TokenMeterService["measure"];

  abstract readonly estimateMessage: TokenMeterService["estimateMessage"];

  abstract readonly contextPressure: TokenMeterService["contextPressure"];
}
