import { Module } from "@morlay/zephyr";
import { UiOpenInApp } from "./open.client.service.ts";

@Module({ providers: [UiOpenInApp] })
export class OpenClientModule {}
