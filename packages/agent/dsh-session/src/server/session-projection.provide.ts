import { provide } from "@morlay/zephyr";
import { SessionProjectionStoreDefault } from "../session-projection-store.service.ts";
import { SessionStatsDefault } from "./session-stats.service.ts";

/** 会话投影：`SessionControllerHost` 建 agent 前的 `Session` 观测来源。 */
// 投影注册表在前，投影单元（`sessionStats`）在后：后者在 `apply` 里就 `register`。
export const provideSessionProjection = provide([SessionProjectionStoreDefault, SessionStatsDefault]);
