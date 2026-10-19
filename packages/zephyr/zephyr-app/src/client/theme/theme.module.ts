import { Module } from "@morlay/zephyr";
import { ThemeDefault } from "./theme.service.ts";

@Module({ providers: [ThemeDefault] })
export class ThemeModule {}
