// 本包要占的两个位置：composer 工具行左侧（list + session scope）与右栏面板（keyed + session scope）。
//
// 位置名只写在这里——贡献处用 `extends` 关联类型，不重复写字符串。
import { SlotProvider, SlotViewBase } from "@morlay/zephyr-app/client";

// 右栏面板那一页的 id（keyed 位置的 key）：包名是天然的唯一值。
export const PANEL_ID = "@morlay/session-mode";

@SlotProvider({ name: "conversation.input.left", multi: true, scoped: true })
export abstract class ConversationInputLeftSlot extends SlotViewBase {}

@SlotProvider({ name: "sidebar.right.pane.tab", multi: true, scoped: true, key: PANEL_ID })
export abstract class SidebarRightPaneTabSlot extends SlotViewBase {}
