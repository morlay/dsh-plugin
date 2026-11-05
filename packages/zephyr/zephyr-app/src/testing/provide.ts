// 进程内传输的**模块**：一装就同时有了「宿主半的 handler 表」与「客户端半的 `Remote` 实现」。
//
// 测试与单机模式都直接 `providers: [...provideLocalRemote()]`：两端在同一个进程里，不需要 wire。
import { provide } from "@morlay/zephyr";
import { RemoteHandlersDefault } from "../api-gateway/remote-handlers.service.ts";
import { LocalRemote } from "./local-remote.ts";

/** 宿主半（handler 表）+ 客户端半（`Remote` 的进程内实现）。 */
export const provideLocalRemote = provide([RemoteHandlersDefault, LocalRemote]);
