// cordis logger 的强类型契约：消费侧 `logger = inject(Logger)`，不读 `ctx.logger`。
// 运行期值由 `bootstrapApplication` 从 `ctx.logger` 直接装入（cordis 原生 logger，不是我们造的服务）。
import type { LoggerService } from "@deepseek-ai/cordis/src/logger.ts";
import { Injectable } from "./token.ts";

@Injectable()
export abstract class Logger implements Pick<LoggerService, "error" | "warn" | "info" | "debug"> {
  /** cordis 的签名是 format + 参数，不是 `...args`。 */
  abstract error(format: unknown, ...params: unknown[]): void;

  abstract warn(format: unknown, ...params: unknown[]): void;

  abstract info(format: unknown, ...params: unknown[]): void;

  abstract debug(format: unknown, ...params: unknown[]): void;
}
