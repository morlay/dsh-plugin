// 输入区浮层的位置（`conversation.input.overlay`）。
//
// 只声明类型与名字；位置本身由 `ui-conversation` 那一行注册，我们的视图通过 `extends` 它来定位。
import { SlotProvider, SlotViewBase } from "@morlay/zephyr-app/client";

/** 输入区浮层的位置（名字与上游 slot 名一致）。 */
@SlotProvider({ name: "conversation.input.overlay", multi: true, key: "command-popup" })
export abstract class ConversationInputOverlaySlot extends SlotViewBase {}
