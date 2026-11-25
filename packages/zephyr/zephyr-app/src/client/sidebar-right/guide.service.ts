// 右栏的**默认页类型**（guide）：上游 `defaultSeed` 在空列里种的就是它。
//
// 只做**类型注册**（`tabs.register`）——它只依赖类型注册表，属框架抽象；正文座位（`sidebar.right.pane.tab`
// key=guide）渲染在容器里，随容器归会话域（`rightbar-seats.ts`）。
//
// 没有这条类型注册，任何展开都会抛 `default tab kind "guide" is not registered`。
import { GUIDE_KIND } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/seed.ts";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { SidebarRightTabs } from "./sidebar-right-tabs.contract.ts";

/** guide 类型的注册行。 */
@Injectable()
export class GuideType implements OnInit, OnDispose {
  /** 类型注册表。 */
  private readonly tabs = inject(SidebarRightTabs);

  /** 撤销函数。 */
  private undo: (() => void) | undefined;

  /** 注册 guide 类型（builtin 兜底）。 */
  onInit(): void {
    this.undo = this.tabs.register({
      id: GUIDE_KIND,
      kind: GUIDE_KIND,
      priority: "builtin",
      title: () => "Right panel",
    });
  }

  /** 卸载：撤注册。 */
  onDispose(): void {
    this.undo?.();
    this.undo = undefined;
  }
}
