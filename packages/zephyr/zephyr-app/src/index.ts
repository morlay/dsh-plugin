// **host 入口**（`@morlay/zephyr-app`）：宿主装配所需的契约与装配函数，仅此而已。
//
// 三条边界：
// 1. **服务实现（`*Default`）不从这里出** —— 它们是装配内部的东西，测试走 `./testing`；
// 2. **`internal/` 不从这里出** —— URL 前缀、vite 插件、模块解析都是框架内部机制；
// 3. **浏览器半不从这里出** —— 见 `./client`（宿主进程加载包入口时不能带进 CSS/React）。
//
// 装配单位是 **provider 清单**：每个域导出一个 `provideXxx(...features)`，装配面只写
// `providers: [...provideXxx()]`（没有 `imports`、没有 Module 容器）。
export { AppEnvDefault } from "./app-env/app-env.service.ts";
export { ClientRowsDefault } from "./rows/rows.service.ts";
export { clientPackagesOf } from "./rows/client-packages.ts";
// 装配层自己的契约（DI 核心不认识它们）：部署参数、wire 路由表、凭证、契约覆盖判据。
export * from "./app-env/app-env.contract.ts";
export * from "./api-gateway/remote-handlers.contract.ts";
export * from "./credentials/credentials.contract.ts";
export * from "./contract-coverage.ts";
export * from "./client-modules/client-modules.contract.ts";
export { provideApiGateway } from "./api-gateway/provide.ts";
export { provideMuxServer } from "./api-gateway/provide.ts";
export { ApiGateway, type ApiGatewayInvocation } from "./api-gateway/api-gateway.contract.ts";

export { RemoteHandlersDefault } from "./api-gateway/remote-handlers.service.ts";
export { MuxServer } from "./api-gateway/mux-server.service.ts";
export { provideConnection } from "./connection/provide.ts";
export { provideLoggerExporter } from "./logger-exporter/provide.ts";
export { provideRemoteAccess } from "./remote-access/provide.ts";
export { provideTypert } from "./typert/provide.ts";
export { provideWeb } from "./web/provide.ts";
export { provideHttp } from "./http/provide.ts";
export { provideFederation } from "./federation/provide.ts";
export { provideRows } from "./rows/provide.ts";
export { provideViteHandoff } from "./vite-handoff/provide.ts";
export * from "./connection/contract.ts";
export * from "./federation/federation.contract.ts";
export * from "./http/serve.contract.ts";
export * from "./remote/remote.contract.ts";
export * from "./remote/remote-result.ts";
export * from "./remote-access/remote-access.contract.ts";
export * from "./rows/rows.contract.ts";
export * from "./typert/typert.contract.ts";
export * from "./vite-handoff/vite-handoff.contract.ts";
export * from "./web/web-server.contract.ts";
export * from "./web/web-startup.contract.ts";

/** 宿主侧的装配清单（`app.get(...)` 之前的一切都在它里面）。 */
export { provideClientModules } from "./client-modules/provide.ts";
