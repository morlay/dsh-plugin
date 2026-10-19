export * from "./contract/index.ts";
// 上游会话的门面在 `./contract`（`session-id.ts`）：包根只聚合契约与默认实现，
// 浏览器半要的值（`SessionId`）从 `./contract` 取，不从包根取。
// 会话域：核心（生命周期 / 投影 / 查询 / token 计量）的契约与默认实现都在根上——它们拆不开。
// **装配函数不在根上**：宿主面在 `./server`、浏览器面在 `./ui`（装配面只从这两个面取 `provideXxx`）。
// 两个子域各有出口、都不从这里导出：`./session-title`（独立能力）与 `./checkpoint-policy`（它依赖 agent，
// 放根会让会话核心反向依赖 agent）。
export * from "./session.service.ts";
export * from "./session-projection-store.service.ts";
export * from "./session-projection-cache.service.ts";
export * from "./session-query.service.ts";
export * from "./token-meter.service.ts";
