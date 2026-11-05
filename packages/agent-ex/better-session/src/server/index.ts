// better-session 的**宿主半**（`@morlay/better-session/server`）：**只出服务相关的**——装配函数与 wire 端点实现。
//
// 规范：`server/` = `endpoint/` 契约的宿主实现 + 同进程端口实现 + `provideXxx`。默认实现与它们的
// 实现细节在包根（与 `dsh-workspace` / `dsh-skill` 同形）；浏览器半在 `./ui`。
export { provideBetterSession } from "./better-session.provide.ts";
export { SessionBalance, provideSessionBalance } from "./balance.provide.ts";

// `../endpoint/` 契约的宿主实现（注册到 wire）。
export { SessionEditorEndpointDefault } from "./session-editor-endpoint.service.ts";

// 运行中 agent 目录的适配行（`SessionAgentControl` 的实现）。
export { SessionAgentControlDefault } from "./session-agent-control.service.ts";
export { SessionAdminEndpointDefault } from "./session-admin-endpoint.service.ts";
