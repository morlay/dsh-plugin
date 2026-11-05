// session-mode 的浏览器半（`@morlay/session-mode/ui`）：RPC 客户端、读面 store、两个视图与装配函数。
export { SessionModeEndpointClient } from "./session-mode-endpoint.client.ts";
export { SessionModeRemoteBinding } from "./session-mode-remote.binding.ts";
export { SessionModeStore } from "./session-mode.store.ts";
export {
  ConversationInputLeftSlot,
  PANEL_ID,
  SidebarRightPaneTabSlot,
} from "./session-mode-slots.ts";
export { SessionModeSeatView } from "./session-mode-seat.view.tsx";
export { SessionModePanelView } from "./session-mode-panel.view.tsx";
export { provideSessionModeUi } from "./session-mode.provide.ts";
export { LOCALE_NS, en, zh, type SessionModeLocaleKey } from "./locales.ts";
