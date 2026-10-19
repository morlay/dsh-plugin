import { Module } from "@morlay/zephyr";
import { Resources } from "./resources.client.service.ts";

@Module({ providers: [Resources] })
export class ResourcesClientModule {}
