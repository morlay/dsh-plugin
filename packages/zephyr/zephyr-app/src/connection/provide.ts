import { provide } from "@morlay/zephyr";
import { ConnectionDefault } from "./connection.service.ts";

/** host 侧的连接面（只有传输：RPC 注册点观测）。认证不在这层。 */
export const provideConnection = provide([ConnectionDefault]);
