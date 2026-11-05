// permission 的 **RPC 面**（`@morlay/dsh-permission/endpoint`）：两组远端的契约 + wire 端点名 + 参数形状。
//
// 与 `contract/` 的分界：那里是进程内的服务面；这里是远端面。宿主侧在 `server/` 实现它，
// 浏览器侧（上游 `ui-user-questions` / `ui-permission-presets`）按同一份 descriptor 调用。
export * from "./user-questions-endpoint.ts";
export * from "./permission-presets-endpoint.ts";
