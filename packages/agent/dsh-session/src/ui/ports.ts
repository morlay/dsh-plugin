// 会话界面**消费**的跨行服务端口（令牌）。
//
// 依赖倒置：消费方（本包的会话界面行）声明自己需要什么，由装配层（`apps/dsh-custom-next`
// 的 `shell/`）提供实现（上游 `ui-sidebar-right` 那一行）。这样会话域不依赖壳层。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.sidebarRight`（右侧面板的对外动作面）。 */
export const SidebarRight = new InjectionToken<unknown>("sidebarRight");

/** `ctx.sidebarRightTabs`（右侧面板的标签类型注册表）。 */
export { SidebarRightTabs } from "@morlay/zephyr-app/client";
