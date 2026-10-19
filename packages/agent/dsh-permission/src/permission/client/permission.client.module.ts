import { Module } from "@morlay/zephyr";
import { UiPermission } from "./permission.client.service.ts";

@Module({ providers: [UiPermission] })
export class PermissionClientModule {}
