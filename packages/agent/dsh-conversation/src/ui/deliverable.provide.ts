// deliverables 域的**浏览器半装配**：交付物卡片 + 右侧「交付物」标签。
//
// 这一行注册进的是**会话界面**已声明的位置（`conversation.chat.turnTail` 等），装配面要把它排在
// `provideSessionSlots()` 之后；行本身住在本域。
import { provide, type ProviderList } from "@morlay/zephyr";
import { DeliverablesSlots } from "./deliverable.slot.ts";

/**
 * 交付物界面的行清单。
 * @returns provider 清单。
 */
export function provideDeliverablesUi(): ProviderList {
  return provide([DeliverablesSlots])();
}
