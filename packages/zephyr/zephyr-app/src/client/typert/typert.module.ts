import { Module } from "@morlay/zephyr";
import { ClientTypertDefault } from "./typert.service.ts";

@Module({ providers: [ClientTypertDefault] })
export class ClientTypertModule {}
