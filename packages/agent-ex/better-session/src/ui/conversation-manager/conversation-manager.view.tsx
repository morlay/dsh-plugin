// 对话管理页的视图与 nav 图标：位置由 `extends` 决定，视图只写 `render()`。
//
// 字典由 `ConversationManagerLocales` 注册（同一 namespace 二次注册会抛），这里只读它绑定的翻译座。
import type { ReactNode } from "react";
import { IconArchiveOutlineRegular } from "@morlay/zephyr-ui";
import { inject } from "@morlay/zephyr";
import { Slot, SlotContribution, SlotView } from "@morlay/zephyr-app/client";
import { ConversationManagerLocales } from "./conversation-manager-locales.contribution.ts";
import { ConversationManagerController } from "./conversation-manager.controller.ts";
import { ConversationManagerPage } from "./conversation-manager-page.tsx";
import { ConversationManagerPageSlot } from "./conversation-manager-page.slot.ts";
import { PANEL_ID, PANEL_ORDER } from "./locales.ts";

/** 页面视图：读装配进来的控制器，渲染页面本体。 */
@SlotView()
export class ConversationManagerPageView extends ConversationManagerPageSlot {
  private readonly locales = inject(ConversationManagerLocales);

  private readonly controller = inject(ConversationManagerController);

  render(): ReactNode {
    return <ConversationManagerPage t={this.locales.t()} {...this.controller.face} />;
  }
}

// nav 图标只画字形：尺寸由 nav 行给，选中态由 nav 行的按钮承担。
function ConversationManagerIcon({ size }: { size?: number }): ReactNode {
  return <IconArchiveOutlineRegular size={size} />;
}

// nav 行：与主面板用同一个 id 成对注册（点击 nav 行时 layout 校验 main 里已有该 id）。
@Slot({})
export class ConversationManagerPanellistContribution extends SlotContribution {
  private readonly locales = inject(ConversationManagerLocales);

  slotRegistrations() {
    const t = this.locales.t();
    return [
      {
        at: "sidebar.panellist" as const,
        options: { id: PANEL_ID, order: PANEL_ORDER, label: () => t("panel") },
        component: ConversationManagerIcon as never,
        inject: true,
      },
    ];
  }
}
