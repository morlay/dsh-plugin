// better-session 的**浏览器半**出口（`@morlay/better-session/ui`）：装配函数 + 面内要暴露的类与类型。
//
// 只引 `./endpoint` 与 `@morlay/zephyr-app/client`；不引包根（那里聚合了宿主实现）。
export { provideBetterSessionUi } from "./better-session.provide.ts";
export {
  ConversationManagerController,
  ConversationManagerRequestError,
  type ConversationManagerFace,
  type ConversationManagerRow,
  type ConversationManagerRowsPage,
} from "./conversation-manager/conversation-manager.controller.ts";
export { ConversationManagerPageSlot } from "./conversation-manager/conversation-manager-page.slot.ts";
export {
  ConversationManagerPageView,
  ConversationManagerPanellistContribution,
} from "./conversation-manager/conversation-manager.view.tsx";
export {
  ConversationManagerLocales,
  type ConversationManagerTranslate,
} from "./conversation-manager/conversation-manager-locales.contribution.ts";
export {
  ConversationManagerPage,
  type ConversationManagerPageProps,
} from "./conversation-manager/conversation-manager-page.tsx";
export {
  NS as CONVERSATION_MANAGER_NS,
  PANEL_ID as CONVERSATION_MANAGER_PANEL_ID,
  PANEL_ORDER as CONVERSATION_MANAGER_PANEL_ORDER,
  en as conversationManagerEn,
  zh as conversationManagerZh,
  type ConversationManagerKey,
} from "./conversation-manager/locales.ts";
export { formatCount, formatPercent, formatTokens } from "./conversation-manager/format.ts";
export { ChatNodeActionsContribution } from "./session-editor/chat-node-actions.contribution.ts";
export {
  NS as SESSION_EDITOR_NS,
  SessionEditorLocales,
  en as sessionEditorEn,
  zh as sessionEditorZh,
  type SessionEditorKey,
  type SessionEditorTranslate,
} from "./session-editor/locales.ts";
export { SessionEditorStore } from "./session-editor/session-editor.store.ts";
export { SessionEditorEndpointClient } from "./session-editor/session-editor-endpoint.client.ts";
export { SessionAdminEndpointClient } from "./conversation-manager/session-admin-endpoint.client.ts";
export type {
  EditableMessageBlock,
  SessionEditorFace,
} from "./session-editor/session-editor.contract.ts";
export { UserMessageNodeView } from "./session-editor/user-message.view.tsx";
