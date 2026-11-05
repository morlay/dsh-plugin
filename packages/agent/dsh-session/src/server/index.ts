// session 的**宿主半**（`@morlay/dsh-session/server`）：宿主面的装配函数 + wire 端点实现。
//
// 装配面只从这里取 `provideXxx`（host 侧）；浏览器半在 `./ui`，契约与默认实现在包根。
export { provideSession } from "./session.provide.ts";

export * from "./session-projection.registry.ts";
export * from "./session-store.plugin.ts";

// 会话宿主的行实现（host 侧；root 不再导出，浏览器半取不到它们）。
export { provideSessionProjection } from "./session-projection.provide.ts";
export { provideSessionProjectionCache } from "./session-projection-cache.provide.ts";
export { provideSessionQuerySqlite } from "./session-query.provide.ts";
export { provideTokenMeter } from "./token-meter.provide.ts";
export { provideSessionsHost } from "./sessions-host.provide.ts";

// 上游会话的宿主机常量（浏览器半不需要，放这里避免把上游 index 拖进 client）。
export { SESSION_FORMAT_VERSION, SessionLogOffset } from "@deepseek-ai/dsh-session";
export { SessionStatsDefault } from "./session-stats.service.ts";
export { TokenMeter } from "@deepseek-ai/dsh-token-meter";
