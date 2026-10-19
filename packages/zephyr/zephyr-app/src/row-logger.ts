// 行作用域的 `ctx.logger`（cordis 的 logger service）：装配观测点用它，不经 `inject(Logger)` 契约。
export interface RowLogger {
  info(format: string, ...args: readonly unknown[]): void;
}

export function loggerOf(ctx: object): RowLogger | undefined {
  return (ctx as { logger?: RowLogger }).logger;
}
