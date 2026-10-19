import { Module } from "@morlay/zephyr";
import { Reference } from "./reference.service.ts";

@Module({ providers: [Reference] })
export class ReferenceModule {}
