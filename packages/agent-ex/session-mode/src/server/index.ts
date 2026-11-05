// session-mode 的**宿主半**（`@morlay/session-mode/server`）：**只出服务相关的**——装配函数与 wire 端点实现。
//
// 规范：`server/` = `endpoint/` 契约的宿主实现 + 同进程端口实现 + `provideXxx`。默认实现与它们
// 依赖的纯函数/纯数据在包根（与 `dsh-workspace` / `dsh-skill` 同形）；浏览器半在 `./ui`。

// `../endpoint/` 契约的宿主实现（注册到 wire）。
export { SessionModeEndpointDefault } from "./session-mode-endpoint.service.ts";
