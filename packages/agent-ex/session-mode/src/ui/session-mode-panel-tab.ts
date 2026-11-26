// 右栏面板的**tab 类型**注册：上游右栏行的面板标签条读的是它自己那一份注册表
// （`ctx.sidebarRightTabs`），没有这一条，面板正文即使注册在 `sidebar.right.pane.tab` 上也不会出现。
//
// 两段式是上游的固定形状：类型（这里是） + 正文（`SessionModePanelView`），两者用同一个 `id`/key 配对。
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { SidebarRightTabs } from "@morlay/zephyr-app/client";
import { PANEL_ID } from "./session-mode-slots.ts";
import { SessionModeLocales } from "./session-mode-locales.contribution.ts";

/** 右栏里那一页的 tab 类型。 */
@Injectable()
export class SessionModePanelTab implements OnInit {
  private readonly tabs = inject(SidebarRightTabs);

  private readonly locales = inject(SessionModeLocales);

  onInit(): void {
    const t = this.locales.t();
    this.tabs.register({
      id: PANEL_ID,
      kind: PANEL_ID,
      // `extension`：外部类型默认档，与上游各 tab 同档（同档不同 kind 可以共存）。
      priority: "extension",
      title: () => t("panel"),
      // **guide 入口**：省略 `guide` 就等于「不上 guide 页」（上游 `tab-registry.ts:409-411` 的
      // `guideEntries` 只来自 `definition.guide`），而本页**没有别的入口**——右栏那一页只由用户
      // 自己从这里打开，漏了它这一页就永远打不开（类型注册上了、正文也注册了，但用户没有按钮）。
      // `order` 接在上游那几档之后（files 10 / terminal 20 / browser 30）。
      guide: [
        {
          id: "panel",
          order: 40,
          title: () => t("panel"),
          description: () => t("panelDescription"),
        },
      ],
    });
  }
}
