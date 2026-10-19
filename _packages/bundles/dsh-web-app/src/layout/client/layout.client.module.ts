import { Module } from "@morlay/zephyr";
import { UiLayout } from "./layout.client.service.ts";

@Module({ providers: [UiLayout] })
export class LayoutClientModule {}
