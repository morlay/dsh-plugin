import { Module } from "@morlay/zephyr";
import { RemoteAccessDefault } from "./remote-access.service.ts";

@Module({ providers: [RemoteAccessDefault] })
export class RemoteAccessModule {}
