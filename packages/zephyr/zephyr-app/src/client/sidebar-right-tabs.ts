// 右侧面板的 tab 类型注册表（上游 `ui-sidebar-right` 的 apply 里 `ctx.reflect.provide('sidebarRightTabs', …)`）。
//
// 它是**跨行共享注册表**：`ui-sidebar-documentpreview` / `ui-sidebar-terminal` / `ui-schedule` 的行
// 都要按类型拿同一份实例。令牌自带上游注册名（`InjectionToken` 的 `serviceName`），
// 所以按名字读（`ctx.get('sidebarRightTabs')`）与按令牌读拿到的是同一个对象。
import { InjectionToken } from "@morlay/zephyr";

/**
 * tab **类型**注册表（上游 `SidebarRightTabRegistry`）的注册面。
 *
 * 只列我们真要用的那两个成员：`register` 加一条类型（返回未注册函数），`entries` 读当前清单。
 * 正文的注册走另一段（`sidebar.right.pane.tab` 的 keyed 座位），两段用同一个 `id`/key 配对。
 */
export interface SidebarRightTabsFace {
  /**
   * 注册一条 tab 类型。
   * @param definition - 类型定义（`id` / `kind` / `title` / `guide` …）。
   * @returns 注销函数。
   */
  register(definition: {
    readonly id: string;
    readonly kind: string;
    readonly priority?: "extension" | "builtin" | "fallback";
    readonly title: () => string;
    readonly guide?: readonly {
      readonly id: string;
      readonly order?: number;
      readonly title: () => string;
      readonly description?: () => string;
    }[];
    readonly patterns?: readonly string[];
  }): () => void;

  /** 当前已注册的类型清单。 */
  entries(): readonly { readonly id: string; readonly kind: string }[];
}

/** `ctx.sidebarRightTabs`：注册面见 `SidebarRightTabsFace`。 */
export const SidebarRightTabs = new InjectionToken<SidebarRightTabsFace>("sidebarRightTabs");
