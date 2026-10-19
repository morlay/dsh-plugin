// 包入口：装配面（`./client-module` 指向这里）+ 宿主装配所需的契约与默认实现。
// 浏览器半（`src/client/` 的官方 client 链）不经这里导出：它由 `src/client/app-boot/index.ts` 直接引，
// 宿主进程加载包入口时不能把 CSS/React 那一侧带进来。
export * from "./app-env.contract.ts";
export * from "./app-env.service.ts";
export * from "./rows/index.ts";
export * from "./federation/index.ts";
export * from "./http/index.ts";
export * from "./remote.contract.ts";
export * from "./client-modules.contract.ts";
export * from "./client-modules.service.ts";
export * from "./typert.contract.ts";
export * from "./typert.module.ts";
export * from "./remote-access.contract.ts";
export * from "./remote-access.module.ts";
export * from "./api-gateway.module.ts";
export * from "./logger-exporter.module.ts";
export * from "./client-modules.module.ts";
export * from "./hmr-path.ts";
export * from "./vite-handoff.contract.ts";
export * from "./vite-handoff.module.ts";
export * from "./web/index.ts";
export * from "./connection/index.ts";
export * from "./api-remotes/mount.ts";

import { ClientModulesModule } from "./client-modules.module.ts";

export default ClientModulesModule;
