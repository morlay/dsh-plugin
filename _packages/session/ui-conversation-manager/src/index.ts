// 包门面：只做具名导出（行入口见 ./cordis-register）。
export * from "./admin/index.ts";
export { ConversationManagerHost } from "./conversation-manager/conversation-manager.service.ts";
export { ConversationManagerModule } from "./conversation-manager/manager.module.ts";
export { conversationManagerRow } from "./cordis-register.ts";
