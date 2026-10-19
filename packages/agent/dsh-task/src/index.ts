// task 的主面：`Goal` 契约（跨包必引）。
//
// 子 domain（`./goal`、`./jobs`、`./plan-mode`、`./tool`）只剩实现行，各自有出口。
export * from "./goal.contract.ts";
