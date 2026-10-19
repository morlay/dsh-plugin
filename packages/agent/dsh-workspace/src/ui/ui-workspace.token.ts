// `ui-workspace` 的服务令牌：跨行注入 `ctx.uiWorkspace`（目录浏览对话框要读 `listDirectory` / `createDirectory`）。
//
// 上游把这个服务建在 `ui-workspace` 那一行内部（`new UiWorkspaceService(ctx, …)`），名字只在行作用域；
// `ui-directory-picker-browse` 是另一行，要按名字拿到它，就必须由 `ui-workspace` 行把它发布成一个令牌。
// 令牌住应用层：它是「这一页装哪几行上游 UI」的接线，不属于任何单个上游包。
import type { UiWorkspace as UiWorkspaceFace } from "@deepseek-ai/dsh-client-ui-workspace/client";
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.uiWorkspace` 的令牌（服务名与上游一致：`uiWorkspace`）。 */
export const UiWorkspace = new InjectionToken<UiWorkspaceFace>("uiWorkspace");
