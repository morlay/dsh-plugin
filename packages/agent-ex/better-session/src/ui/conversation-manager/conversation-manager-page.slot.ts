// 对话管理页占的位置：`main` 的 `conversations` key。
//
// 主区是 keyed 位置（`ui-layout` 声明），同 key 同 priority 二次注册会抛，所以页面只在这里声明一次位置，
// 视图 `extends` 它即可——贡献处不写 slot 字符串。
import { SlotProvider, SlotViewBase } from "@morlay/zephyr-app/client";

/** 主面板的「对话管理」位置。 */
@SlotProvider({ name: "main", key: "conversations" })
export abstract class ConversationManagerPageSlot extends SlotViewBase {}
