// 上下文菜单契约：上游 `ui-context-menu` 注册的 `contextMenus` 服务面。
//
// home 放在框架层（与 `Layout` / `Locale` / `Shortcuts` 一样）：提供方在 `@morlay/dsh-workspace/ui`、
// 消费方在 `@morlay/dsh-session/ui`，两边都不该把对方的 index 拖进来（那会成环，装饰器参数里的
// `ContextMenus` 就成了 TDZ：`Cannot access 'ContextMenus' before initialization`）。
//
// 为什么要契约：`ui-workspace` 的行内菜单用**结构化接口**（`ctx.contextMenus.register`），
// 而那个服务是上游在自己的行里 `ctx.provide('contextMenus', …)` 注册的。装配层看不到这条依赖，
// 拓扑排序就会把 `ui-workspace` 排到菜单行前面——`contextMenus` 是 `undefined`，
// 上游的严格读直接抛 `cannot get property "contextMenus" without inject`。
// 立一份契约，两边都 `inject` 它，顺序由装配器保证。
import type { ContextMenus as UpstreamContextMenus } from "@deepseek-ai/dsh-client-ui-context-menu/client";
import { Injectable } from "@morlay/zephyr";

/** 上游其余成员（本仓只用到注册与打开，但契约必须列全：少一条，上游用到时读到 `undefined`）。 */
type Upstream = UpstreamContextMenus;

@Injectable()
export abstract class ContextMenus {
  /** 注册一个可被菜单展示的对象类型。 */
  abstract readonly register: Upstream["register"];

  /** 打开某个对象的菜单。 */
  abstract readonly open: Upstream["open"];

  /** 关闭当前菜单。 */
  abstract readonly close: Upstream["close"];

  /** 提示条（菜单里的轻量反馈）。 */
  abstract readonly notify: Upstream["notify"];
}
