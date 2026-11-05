// 会话持久化：契约 + 落盘实现 + 装配模块。
export * from "./contract/index.ts";
export * from "./session-persistence.service.ts";
export * from "./session-persistence.provide.ts";

// 与本包契约同名的上游符号：显式导出本包的，覆盖上游那份（TS 显式优先，运行时也只出我们的契约）。
export { SessionPersistence } from "./contract/session-persistence.contract.ts";

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-session-persistence`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-session-persistence";
