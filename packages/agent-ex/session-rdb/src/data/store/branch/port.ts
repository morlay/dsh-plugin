// 分支端口的形状在 `contract/`（最底层）：`contract/session-rdb-store.contract.ts` 引用它，
// 实现（`createBranchPort`，在 `admin/branch-port.ts`）也从这里取。
export type { BranchLog, BranchPort } from "../../../contract/branch-port.contract.ts";
