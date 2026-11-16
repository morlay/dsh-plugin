// 宿主进程内的**资源链装配面**：行清单 + 联邦预编译 + vite 交接。
//
// 它们跑在宿主进程里，会带上构建链（rolldown / vite / chokidar / lightningcss）。
// **不从主出口出**：只要契约的消费方（业务包的 host 半）不该为它们付模块图成本。
// 装配面（apps）从 `@morlay/zephyr-app/node` 取；纯 host 服务（web / http / api-gateway / app-env…）仍在主出口。
export { provideClientModules } from "./client-modules/provide.ts";
// 两条**空契约**在这一面也出一次：拿这一面搭 dev 装配的人（应用入口装 `DevHmr` / `ClientAssets`）
// 不必再回到主出口取一次令牌——同一份契约类，两条出口指向同一个模块实例。
export * from "./client-assets/index.ts";
export * from "./dev-hmr/index.ts";
export { provideViteHandoff } from "./vite-handoff/provide.ts";
export { provideFederation } from "./federation/provide.ts";
export { FederationDefault } from "./federation/federation.service.ts";
