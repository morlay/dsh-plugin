// 会话域：核心（生命周期 / 投影 / 查询 / token 计量）都在根上——它们拆不开。
// 两个子域各有出口、都不从这里导出：`./session-title`（独立能力）与 `./checkpoint-policy`（它依赖 agent，
// 放根会让会话核心反向依赖 agent）。
export * from "./session.contract.ts";
export * from "./session.events.ts";
export * from "./session.service.ts";
export * from "./session.module.ts";
export * from "./session-projection.contract.ts";
export * from "./session-projection.service.ts";
export * from "./session-projection.module.ts";
export * from "./session-projection-cache.contract.ts";
export * from "./session-projection-cache.service.ts";
export * from "./session-projection-cache.module.ts";
export * from "./session-query.contract.ts";
export * from "./session-query.service.ts";
export * from "./session-query.module.ts";
export * from "./token-meter.contract.ts";
export * from "./token-meter.service.ts";
export * from "./token-meter.module.ts";
// 上游会话持久化面：跨包被引用，留在入口。
export { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
