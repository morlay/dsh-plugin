import { Module } from "@morlay/zephyr";
import { RemoteDefault } from "./remote.service.ts";

@Module({ providers: [RemoteDefault] })
export class RemoteModule {}
