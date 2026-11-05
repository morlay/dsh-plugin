// 对话界面的 **client 类型**（上游 `ui-chat` / `ui-conversation` 的 `/client` 面）：两端共用的形状。
//
// 别的域的行（better-session 的消息动作视图）要按这些形状写 props，从这里取，不直连上游包。
export type {
  ChatNodeOwnerProps,
  ChatNodeViewProps,
  ChatViewSlotProps,
  UserContentAttachment,
  UserContentData,
  UserMessageNode,
} from "@deepseek-ai/dsh-client-ui-chat/client";
/** 一条用户消息的文本事实（`ui-conversation` 的 client 面）。 */
export type { UserTextFacts } from "@deepseek-ai/dsh-client-ui-conversation/client";
