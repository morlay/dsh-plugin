import { Module } from "@morlay/zephyr";
import { ViteHandoffDefault } from "./vite-handoff.service.ts";

@Module({ providers: [ViteHandoffDefault] })
export class ViteHandoffModule {}
