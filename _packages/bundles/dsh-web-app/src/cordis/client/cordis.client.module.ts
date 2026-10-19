import { Module } from "@morlay/zephyr";
import { UiCordis } from "./cordis.client.service.ts";

@Module({ providers: [UiCordis] })
export class CordisClientModule {}
