import { Module } from "@morlay/zephyr";
import { Locale } from "./locale.client.service.ts";

@Module({ providers: [Locale] })
export class LocaleClientModule {}
