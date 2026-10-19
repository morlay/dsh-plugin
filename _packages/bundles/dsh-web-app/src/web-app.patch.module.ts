import { Module } from "@morlay/zephyr";
import { DshWebAppClientPluginsModule } from "./web-app.client.module.ts";
import { DshWebAppHostModule } from "./web-app.host.module.ts";

@Module({ imports: [DshWebAppHostModule, DshWebAppClientPluginsModule] })
export class DshWebAppPatchModule {}
