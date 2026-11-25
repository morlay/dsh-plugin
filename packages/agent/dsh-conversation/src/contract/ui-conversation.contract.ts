// `ctx.uiConversation`：会话装配面（上游 `ui-conversation` 行发布的服务：用户文本规则、绑定、视图）。
//
// 名字是上游注册名 `uiConversation`（显式对齐，不靠类名派生）。行（`ui/conversation/conversation-slots.ts`）
// 与契约同在本包。
//
// 契约类不带成员：消费方只把它交给上游插件的 `mount` deps；面见 `UiConversationFace`。
import type { UiConversation as UpstreamUiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { Injectable } from "@morlay/zephyr";

/** `ctx.uiConversation` 的面（上游 `UiConversation`）。 */
export type UiConversationFace = UpstreamUiConversation;

/** `ctx.uiConversation`（会话装配面）：面见 `UiConversationFace`。 */
@Injectable({ name: "uiConversation" })
export abstract class UiConversation {}
