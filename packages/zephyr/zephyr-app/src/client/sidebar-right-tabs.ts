// 右侧面板的 tab 类型注册表（上游 `ui-sidebar-right` 的 apply 里 `ctx.reflect.provide('sidebarRightTabs', …)`）。
//
// 它是**跨行共享注册表**：`ui-sidebar-documentpreview` / `ui-sidebar-terminal` / `ui-schedule` 的行
// 都要按类型拿同一份实例。令牌自带上游注册名（`InjectionToken` 的 `serviceName`），
// 所以按名字读（`ctx.get('sidebarRightTabs')`）与按令牌读拿到的是同一个对象。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.sidebarRightTabs`：`register` / `get` / `entries` / `subscribe` 四个方法由上游注册表提供。 */
export const SidebarRightTabs = new InjectionToken<unknown>("sidebarRightTabs");
