import { Module } from "@morlay/zephyr";
import { TypertDefault } from "./typert.service.ts";

@Module({ providers: [TypertDefault] })
export class TypertModule {}
