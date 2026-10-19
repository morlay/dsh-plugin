import { Module } from "@morlay/zephyr";
import { ClientConnection } from "./connection.client.service.ts";
import { ClientGateway } from "./gateway.client.service.ts";

@Module({ providers: [ClientConnection, ClientGateway] })
export class ConnectionClientModule {}
