import { Module } from "@morlay/zephyr";
import { ApiGatewayDefault } from "./api-gateway.service.ts";

/** Remote 网关行：提供 `/api/*` 的 RPC 与 WebSocket 路由（依赖 `connection` + `webServer`）。 */
@Module({ providers: [ApiGatewayDefault] })
export class ApiGatewayModule {}
