import { provide } from "@morlay/zephyr";
import { ClientConnectionDefault } from "./connection.service.ts";

/** client 侧的连接面（自己实现：同源 HTTP + WebSocket）。 */
export const provideClientConnection = provide([ClientConnectionDefault]);
