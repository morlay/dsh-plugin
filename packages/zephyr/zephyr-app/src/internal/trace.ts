import type { Context } from "@deepseek-ai/cordis";

/**
 * 诊断细节（逐包预编译、逐请求那一类）的具名 logger。
 *
 * 名字交给 logger（`ctx.logger(name)`）；**值走参数**、不拼进文本——cordis 的 logger 没有"每次调用带
 * meta"这回事（`meta` 是 logger 实例级的），所以结构化的东西作为 `%o` 的参数传（exporter 拿到的
 * `args` 里是结构与值，而不是一段 `key=value` 文本）。键名若出现，用 `.` 分层、不带空格。
 *
 * **是否调用**由本开关决定：运行时的日志门槛不由我们定（loader 注册的 exporter 允许 DEBUG），而这类细节
 * 一次启动两千多行、每请求一行，默认不调，`DSH_TRACE=1` 时再调。出问题的几行走 `warn`。
 * @param ctx - 这条链的上下文。
 * @param name - 这个 logger 的名字（如 `federation` / `vite`）。
 * @returns `(format, ...args)` 形态的诊断出口；开关没开时什么都不做。
 */
export function traceOf(
  ctx: Context,
  name: string,
): (format: string, ...args: readonly unknown[]) => void {
  if (process.env["DSH_TRACE"] !== "1") return () => {};
  const logger = ctx.logger(name);
  return (format: string, ...args: readonly unknown[]) => {
    logger.debug(format, ...args);
  };
}
