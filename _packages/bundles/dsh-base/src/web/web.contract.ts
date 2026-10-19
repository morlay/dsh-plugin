// web 运行时的契约：令牌按服务语义命名（上游注册名 `web`）。
import type WebRuntimeService from "@deepseek-ai/dsh-web";
import { Injectable } from "@morlay/zephyr";

/** web 运行时的公开面（服务基类的 ctx / fiber 不在契约里）。 */
interface WebFace {
  readonly registerSearchProvider: WebRuntimeService["registerSearchProvider"];
  readonly registerFetchProvider: WebRuntimeService["registerFetchProvider"];
  readonly search: WebRuntimeService["search"];
  readonly fetch: WebRuntimeService["fetch"];
}

@Injectable()
export abstract class Web implements WebFace {
  abstract readonly registerSearchProvider: WebFace["registerSearchProvider"];

  abstract readonly registerFetchProvider: WebFace["registerFetchProvider"];

  abstract readonly search: WebFace["search"];

  abstract readonly fetch: WebFace["fetch"];
}
