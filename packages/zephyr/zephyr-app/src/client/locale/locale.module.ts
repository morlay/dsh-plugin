import { Module } from "@morlay/zephyr";
import { LocaleDefault } from "./locale.service.ts";

@Module({ providers: [LocaleDefault] })
export class LocaleModule {}
