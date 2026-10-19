// session 的**宿主半**（`@morlay/dsh-session/server`）：宿主面的装配函数 + wire 端点实现。
//
// 装配面只从这里取 `provideXxx`（host 侧）；浏览器半在 `./ui`，契约与默认实现在包根。
export { provideSession } from "./session.provide.ts";

// 会话宿主的行实现（host 侧；root 不再导出，浏览器半取不到它们）。
export { SessionControllerHost } from "./session-controller.host.ts";
export { RemoteSessionHost, SessionControllerRow } from "./session-controller.row.ts";
export { ScheduleRow } from "./schedule.service.ts";
export { provideSessionProjection } from "./session-projection.provide.ts";
export { provideSessionProjectionCache } from "./session-projection-cache.provide.ts";
export { provideSessionQuerySqlite } from "./session-query.provide.ts";
export { provideTokenMeter } from "./token-meter.provide.ts";
export { provideSessionsHost } from "./sessions-host.provide.ts";
export { provideSessionRemote } from "./session-remote.provide.ts";

// 端点实现（`../endpoint/` 契约的宿主半）。
export { ToolResultsDefault } from "./tool-results.service.ts";
export { SessionEndpointDefault } from "./session-endpoint.service.ts";
export { FileReferencesDefault } from "./file-references.service.ts";

// 上游会话的宿主机常量（浏览器半不需要，放这里避免把上游 index 拖进 client）。
export { SESSION_FORMAT_VERSION, SessionLogOffset } from "@deepseek-ai/dsh-session";
