// 右栏面板的 **tab 类型**注册：上游右栏行的标签条读它自己的注册表
// （`ctx.sidebarRightTabs`）——没有这一条，正文注册在 `sidebar.right.pane.tab` 上也不会出现。
//
// 两段式是上游的固定形状：类型（这里是） + 正文（`DesktopPanelView`），两者用同一个 `id`/`key` 配对。
import { Injectable, inject, type OnInit } from "@morlay/zephyr";
import { SidebarRightTabs } from "@morlay/zephyr-app/client";
import { PANEL_ID } from "./panel-slots.ts";

/** 右栏里那一页的 tab 类型。 */
@Injectable()
export class DesktopPanelTab implements OnInit {
  private readonly tabs = inject(SidebarRightTabs);

  onInit(): void {
    this.tabs.register({
      id: PANEL_ID,
      kind: PANEL_ID,
      // `extension`：外部类型默认档，与上游各 tab 同档（同档不同 kind 可以共存）。
      priority: "extension",
      // 文案先直写：本包只有这一处界面文案，不引字典（引了就要维护 8 个语种的空壳）。
      title: () => "浏览器",
    });
  }
}
