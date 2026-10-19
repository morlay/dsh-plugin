import { toCordis } from "@morlay/zephyr/compat";
import { ConversationManagerModule } from "./conversation-manager/manager.module.ts";

// dsh 行入口：host 锚点与管理面端点一起装进同一行。
export const conversationManagerRow = toCordis(ConversationManagerModule, {
  name: "ui-conversation-manager",
});

export default conversationManagerRow;
