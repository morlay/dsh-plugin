// permission 的 **RPC 面**（`@morlay/dsh-permission/endpoint`）：两组远端的契约 + wire 端点名 + 参数形状，
// 外加两端都按它 `$mount` 的两份 **remote descriptor**。
//
// 与 `contract/` 的分界：那里是进程内的服务面；这里是远端面。宿主侧在 `server/` 实现它，
// 浏览器侧（上游 `ui-user-questions` / `ui-permission-presets`）按同一份 descriptor 调用。
// **这一面必须 client-safe**：浏览器半（`@morlay/dsh-conversation/ui` 的批准/提问行）只从这里取远端身份，
// 取包根会把三个宿主 service 拖进浏览器 bundle（判据见包内 `.agents/designs`）。
export * from "./user-questions-endpoint.ts";
export * from "./permission-presets-endpoint.ts";

// 上游 remote 面的 owner 是权限域：别的域（会话界面的批准/提问行）从这里取，不直连上游包。
// 上游 `<pkg>/remote` 是**生成出来的客户端描述**（只依赖 zod），放这一面而不是包根：
// descriptor 是两端共用的 wire 身份，浏览器半与宿主注册读的是同一份。
export { TYPERT_REMOTE as PERMISSION_PRESETS_REMOTE } from "@deepseek-ai/dsh-permission-presets/remote";
export { TYPERT_REMOTE as USER_QUESTIONS_REMOTE } from "@deepseek-ai/dsh-user-questions/remote";
