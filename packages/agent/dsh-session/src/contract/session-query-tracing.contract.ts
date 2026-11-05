// 查询面的**轨迹**词汇（上游 `@deepseek-ai/dsh-session-query/src/tracing.ts`）：三个纯函数。
//
// `traceEvent` / `traceSession` / `currentSurfaceEvents` 是只读折叠，不碰服务，所以放契约面。
export {
  currentSurfaceEvents,
  traceEvent,
  traceSession,
} from "@deepseek-ai/dsh-session-query/src/tracing.ts";
