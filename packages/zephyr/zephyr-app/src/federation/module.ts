import { Module } from "@morlay/zephyr";
import { FederationDefault } from "./federation.service.ts";

@Module({ providers: [FederationDefault] })
export class FederationModule {}
