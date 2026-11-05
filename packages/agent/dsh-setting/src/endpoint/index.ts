// setting 域的**端点面**（`@morlay/dsh-setting/endpoint`）：两端共用的值与类型。
//
// 上游把 `settings/*` 端点放在 `@deepseek-ai/dsh-api-settings-controller`，那归 setting 域所有；
// 别的域（permission 的权限设置行）要挂这份 remote 时从这里取，不再直连上游包。
export { TYPERT_REMOTE as SETTINGS_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";
export * from "./settings.group.ts";
