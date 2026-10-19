import { Module } from "@morlay/zephyr";
import { ClientModulesDefault } from "./client-modules.service.ts";
import { FederationModule } from "./federation/index.ts";
import { HttpModule } from "./http/index.ts";
import { RowsModule } from "./rows/index.ts";
import { ViteHandoffModule } from "./vite-handoff.module.ts";

/** 宿主装配根：行清单 + 联邦 + 页面兜底 + 装配面。client 链的装配在 `src/client/`（浏览器入口）。 */
@Module({
  imports: [RowsModule, ViteHandoffModule, FederationModule, HttpModule],
  providers: [ClientModulesDefault],
})
export class ClientModulesModule {}
