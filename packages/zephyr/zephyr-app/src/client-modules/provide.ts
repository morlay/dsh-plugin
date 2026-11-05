import { provide } from "@morlay/zephyr";
import { ClientModulesDefault } from "./client-modules.service.ts";
import { provideFederation } from "../federation/index.ts";
import { provideHttp } from "../http/index.ts";
import { provideRows } from "../rows/index.ts";
import { provideViteHandoff } from "../vite-handoff/provide.ts";

/** 宿主装配根：行清单 + 联邦 + 页面兜底 + 装配面。client 链的装配在 `src/client/`（浏览器入口）。 */
export const provideClientModules = provide([
  ...provideRows(),
  ...provideViteHandoff(),
  ...provideFederation(),
  ...provideHttp(),
  ClientModulesDefault,
]);
