import { Module } from "@morlay/zephyr";
import { Modules } from "./modules.client.service.ts";

@Module({ providers: [Modules] })
export class ModulesClientModule {}
