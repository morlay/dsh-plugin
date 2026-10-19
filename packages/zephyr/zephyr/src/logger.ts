// cordis logger 的强类型契约：消费侧 `logger = inject(Logger)`，不读 `ctx.logger`。
// 与其它契约一致：抽象类 + `@Injectable()`；解析走 `serviceResolver`（cordis 的 logger 是接口，不是可构造的上游类）。
import type { LoggerService } from "@deepseek-ai/cordis";
import type { Context } from "./injection.ts";
import { Injectable } from "./token.ts";

interface LoggerFace extends Pick<LoggerService, "error" | "warn" | "info" | "debug"> {}

@Injectable()
export abstract class Logger implements LoggerFace {
  static readonly serviceResolver = (ctx: Context): unknown => (ctx as { logger?: unknown }).logger;

  abstract error(...args: unknown[]): void;

  abstract warn(...args: unknown[]): void;

  abstract info(...args: unknown[]): void;

  abstract debug(...args: unknown[]): void;
}
