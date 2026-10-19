import { Module } from "@morlay/zephyr";
import { ClientHmr } from "./client-hmr.client.service.ts";

@Module({ providers: [ClientHmr] })
export class ClientHmrClientModule {}
