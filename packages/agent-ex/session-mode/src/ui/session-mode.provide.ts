// session-mode 的浏览器半装配：端点客户端 → 远端绑定 → 读面 store → 两个视图（composer 的 chip、右栏面板）。
import { provide } from "@morlay/zephyr";
import { SessionModeEndpointClient } from "./session-mode-endpoint.client.ts";
import { SessionModeRemoteBinding } from "./session-mode-remote.binding.ts";
import { SessionModeStore } from "./session-mode.store.ts";
import { SessionModeLocales } from "./session-mode-locales.contribution.ts";
import { SessionModePanelTab } from "./session-mode-panel-tab.ts";
import { SessionModeSeatView } from "./session-mode-seat.view.tsx";
import { SessionModePanelView } from "./session-mode-panel.view.tsx";

// 顺序 = 依赖：客户端端点先（store 与视图都经它走 wire）；视图在最后（它们的 `onInit` 要注册到位置上）。
export const provideSessionModeUi = provide([
  SessionModeEndpointClient,
  SessionModeRemoteBinding,
  SessionModeStore,
  // 字典必须是第一条：tab 的标题/guide 文案都经它 bind。
  SessionModeLocales,
  // tab **类型**先注册：正文（PanelView）按同一个 key 挂到 `sidebar.right.pane.tab` 上。
  SessionModePanelTab,
  SessionModeSeatView,
  SessionModePanelView,
]);
