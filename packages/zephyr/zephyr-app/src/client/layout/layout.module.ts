import { Module } from "@morlay/zephyr";
import { LayoutDefault } from "./layout.service.ts";

@Module({ providers: [LayoutDefault] })
export class LayoutModule {}
