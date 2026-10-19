import { provide } from "@morlay/zephyr";
import { SessionProjectionStoreDefault } from "../session-projection-store.service.ts";

/** 会话投影：`SessionControllerHost` 建 agent 前的 `Session` 观测来源。 */
export const provideSessionProjection = provide([SessionProjectionStoreDefault]);
