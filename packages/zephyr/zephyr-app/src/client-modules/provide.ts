import { provide } from "@morlay/zephyr";
import { ClientModulesDefault } from "./client-modules.service.ts";
import { ViteClientAssets } from "../client-assets/vite-client-assets.service.ts";
import { provideFederation } from "../federation/index.ts";
import { provideHttp } from "../http/index.ts";
import { provideViteHandoff } from "../vite-handoff/provide.ts";

/**
 * 宿主装配根：行清单 + 联邦 + 页面兜底 + 装配面。client 链的装配在 `src/client/`（浏览器入口）。
 *
 * `ViteClientAssets` 是 `ClientAssets` 的 dev 实现（本票先住在本包，下一个票随开发运行时搬到
 * `zephyr-dev`）：`ServeDefault` 把它当**必需前置**注入，所以它必须和 `provideHttp()` 同批装。
 */
export const provideClientModules = provide([
  ...provideViteHandoff(),
  ViteClientAssets,
  ...provideFederation(),
  ...provideHttp(),
  ClientModulesDefault,
]);
