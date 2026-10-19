import { Module } from "@morlay/zephyr";
import { UiRenderer } from "./renderer.client.service.ts";

@Module({ providers: [UiRenderer] })
export class RendererClientModule {}
