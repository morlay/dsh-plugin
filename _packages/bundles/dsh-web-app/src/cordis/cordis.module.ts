import { Module } from "@morlay/zephyr";
import { CordisClientRunner, CordisHostRunner, CordisInspectProviders } from "./cordis.service.ts";

@Module({ providers: [CordisHostRunner, CordisInspectProviders, CordisClientRunner] })
export class CordisModule {}
