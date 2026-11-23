import { provide } from "@morlay/zephyr";
import { ConversationManagerController } from "./conversation-manager/conversation-manager.controller.ts";
import { ConversationManagerLocales } from "./conversation-manager/conversation-manager-locales.contribution.ts";
import { SessionAdminEndpointClient } from "./conversation-manager/session-admin-endpoint.client.ts";
import {
  ConversationManagerPageView,
  ConversationManagerPanellistContribution,
} from "./conversation-manager/conversation-manager.view.tsx";
import { ChatNodeActionsContribution } from "./session-editor/chat-node-actions.contribution.ts";
import { SessionEditorLocales } from "./session-editor/locales.ts";
import { SessionEditorEndpointClient } from "./session-editor/session-editor-endpoint.client.ts";
import { SessionEditorStore } from "./session-editor/session-editor.store.ts";

// better-session 的浏览器半：三个消息动作（编辑 / 重试 / 分叉）与对话管理页。
//
// 清单只收 Provider 类：位置类（`@SlotProvider` 的抽象类）只承载类型身份，由视图 `extends` 它定位，
// 本身不实例化。顺序 = 依赖：字典与端点客户端先，再是 store / 贡献 / 视图。
export const provideBetterSessionUi = provide([
  ConversationManagerLocales,
  SessionEditorLocales,
  SessionEditorEndpointClient,
  SessionAdminEndpointClient,
  SessionEditorStore,
  ChatNodeActionsContribution,
  ConversationManagerController,
  ConversationManagerPageView,
  ConversationManagerPanellistContribution,
]);
