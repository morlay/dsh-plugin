import { Module } from "@morlay/zephyr";
import { ConfigFormsDefault } from "./config-forms.service.ts";

@Module({ providers: [ConfigFormsDefault] })
export class ConfigFormsModule {}
