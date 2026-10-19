import { Module } from "@morlay/zephyr";
import { UiTheme } from "./theme.client.service.ts";

@Module({ providers: [UiTheme] })
export class ThemeClientModule {}
