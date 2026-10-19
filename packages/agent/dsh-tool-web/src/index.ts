// tool-web 的主面：只有 `Web` 契约（跨包必引）。
//
// 子 domain（`./tool`、`./web`）各自有出口，入口不聚合。
export * from "./web/web.contract.ts";
