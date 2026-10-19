import { Module } from "@morlay/zephyr";
import { UiTool } from "./tool.client.service.ts";

@Module({ providers: [UiTool] })
export class ToolClientModule {}
