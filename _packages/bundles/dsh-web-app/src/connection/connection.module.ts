import { Module } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { ConnectionDefault } from "./connection.service.ts";

@Module({
  providers: [
    ConnectionDefault.withConfig({ trustedHosts: jsExpr<any>((ctx: any) => ctx.webStartup.trustedHosts) }),
  ],
})
export class ConnectionModule {}
