// 会话持久化：契约 + 落盘实现 + 装配模块。
export * from "./contract/index.ts";
export * from "./session-persistence.service.ts";
export * from "./session-persistence.provide.ts";

// 与本包契约同名的上游符号：显式导出本包的，覆盖上游那份（TS 显式优先，运行时也只出我们的契约）。
export { SessionPersistence } from "./contract/session-persistence.contract.ts";

// 包根**不**转出上游的整份导出：这一面只出本包自己定义的东西（契约 / 实现 / 装配）。
// 消费方只从包根取 `SessionPersistence` / `SessionPersistenceDefault` / `provideSessionPersistence`；
// 要新词时显式加一条，类型与纯函数进 `./contract`，实现类才放这里。
export * from "./jsonl.service.ts";
