import { provide } from "@morlay/zephyr";
import { ApiGatewayDefault } from "./api-gateway.service.ts";
import { MuxServer } from "./mux-server.service.ts";
import { RemoteHandlersDefault } from "./remote-handlers.service.ts";

/**
 * 网关域的两份装配清单——**分开导出**，因为它们的运行时要求不同：
 *
 * - `provideMuxServer()`：`/api/remote.mux` 的 WebSocket 服务（握手 + 帧 + 分发），要 `web-server`
 *   （监听端口），只给真正起服务的装配面用；
 * - `provideApiGateway()`：纯 wire 面（方法路由表 `RemoteHandlers` + gateway 面 `ApiGateway`），
 *   不监听端口——测试与宿主半的 spec 用它，不必被迫拉起一个端口。
 */

/** `/api/remote.mux` 的 WebSocket 服务。 */
export const provideMuxServer = provide([MuxServer]);

/** Remote 网关的纯 wire 面（方法路由表 + gateway 面）。 */
export const provideApiGateway = provide([RemoteHandlersDefault, ApiGatewayDefault]);
