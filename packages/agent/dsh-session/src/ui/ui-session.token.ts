// `ui-session` 的服务令牌：跨行注入 `ctx.uiSession`（右侧面板等行要读它）。
//
// 与 `uiWorkspace` 同理：上游把服务建在 `ui-session` 那一行内部（`new UiSessionService(ctx, sessions)`，
// `super(ctx, 'uiSession')`），名字只在行作用域。要让别的行按名字拿到，就必须由 `ui-session` 行发布成令牌。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.uiSession` 的令牌（服务名与上游一致：`uiSession`）。 */
export const UiSession = new InjectionToken<unknown>("uiSession");
