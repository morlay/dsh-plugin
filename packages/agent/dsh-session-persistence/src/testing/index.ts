// 会话落盘的**测试支撑**出口（`@morlay/dsh-session-persistence/testing`）：契约套件。
//
// 下游（替换实现：RDB、别的后端）只要给一个「造 backend」的回调就能跑上游那 20 条语义，
// 不必自己再抄一份套件。fixtures 从会话域的 `@morlay/dsh-session/testing` 取。
export { runPersistenceContract } from "./contract.ts";
export type { ContractBackend, ContractBackendInstance } from "./contract.ts";
