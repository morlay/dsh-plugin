// **host 入口**（`@morlay/zephyr-app`）：宿主装配所需的契约与装配函数，仅此而已。
export * from "./home-paths.ts";

//
// 三条边界：
// 1. **服务实现（`*Default`）不从这里出** —— 它们是装配内部的东西，测试走 `./testing`；
// 2. **`internal/` 不从这里出** —— URL 前缀、vite 插件、模块解析都是框架内部机制；
// 3. **浏览器半不从这里出** —— 见 `./client`（宿主进程加载包入口时不能带进 CSS/React）。
//
// 装配单位是 **provider 清单**：每个域导出一个 `provideXxx(...features)`，装配面只写
// `providers: [...provideXxx()]`（没有 `imports`、没有 Module 容器）。
export { AppEnvDefault } from "./app-env/app-env.service.ts";
export { provideAppEnv } from "./app-env/provide.ts";
// 装配层自己的契约（DI 核心不认识它们）：部署参数、wire 路由表、凭证、契约覆盖判据。
export * from "./app-env/app-env.contract.ts";
export * from "./api-gateway/remote-handlers.contract.ts";
export * from "./credentials/credentials.contract.ts";
export * from "./contract-coverage.ts";
export * from "./client-modules/client-modules.contract.ts";
export { provideApiGateway } from "./api-gateway/provide.ts";
export { provideMuxServer } from "./api-gateway/provide.ts";

export { RemoteHandlersDefault } from "./api-gateway/remote-handlers.service.ts";
export { MuxServer } from "./api-gateway/mux-server.service.ts";
export { provideConnection } from "./connection/provide.ts";
export { provideLoggerExporter } from "./logger-exporter/provide.ts";
export { provideRemoteAccess } from "./remote-access/provide.ts";
export { RemoteAccess } from "./remote-access/remote-access.contract.ts";
export { provideTypert } from "./typert/provide.ts";
export { provideWeb } from "./web/provide.ts";
export { provideServerHmr } from "./web/server-hmr.provide.ts";
export { ServerHmr, type ServerHmrOptions } from "./internal/server-hmr.ts";
export { provideHttp } from "./http/provide.ts";
// 装配面用 `configure(FederationDefault, { dev, devFiles })` 设定预构建的开关与范围；
// 实现（与 vite 交接、联邦预编译）走 `./node`：主出口不带构建链。
export type { FederationConfig } from "./federation/federation.contract.ts";
export * from "./connection/contract.ts";
export * from "./federation/federation.contract.ts";
export * from "./http/serve.contract.ts";
export * from "./remote/remote.contract.ts";
export * from "./api-remotes/remote-descriptor.contract.ts";
export * from "./remote/remote-result.ts";
export * from "./remote-access/remote-access.contract.ts";
export * from "./typert/typert.contract.ts";
export * from "./typert/gateway.contract.ts";
export * from "./vite-handoff/vite-handoff.contract.ts";
export * from "./web/web-server.contract.ts";
export * from "./web/web-startup.contract.ts";
// 设置项的**注册机制**：schema 注册表 + `@Setting` 装饰器。各域用它注册自己的设置项，
// setting 包只留数据面（`settings.json` 的读写）。
export * from "./setting.contract.ts";
// 两个**具体设置项**：`ui-theme` 的 schema 与「开发者工具」偏好（`ui-settings` 命名空间）。
export * from "./ui-theme-schema.service.ts";
export * from "./ui-settings-preferences.service.ts";
export * from "./setting-schema.service.ts";
// `Setting` 装饰器与 `settingRow` 模板属**设置机制的使用方**，已搬到 `@morlay/dsh-setting`；
// 这里只留注册表（`SettingSchema`，本包自己的 ui 也在用）。

/** 宿主侧的装配清单（`app.get(...)` 之前的一切都在它里面）走 `./node`。 */
