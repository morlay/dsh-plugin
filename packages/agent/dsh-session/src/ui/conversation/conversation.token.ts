// 会话域的两个跨行服务令牌：`uiConversation`（装配面）与 `conversation`（控制器）。
//
// 它们由 `ui-conversation` 那一行内部创建，名字只在行作用域；别的行要按名字读就必须发布成令牌。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.uiConversation`（会话装配面：用户文本规则、绑定、视图）。 */
export const UiConversation = new InjectionToken<unknown>("uiConversation");

/** `ctx.conversation`（会话控制器：打开/关闭/草案）；`uiConversation` 是它的装配面，两者不同。 */
export const Conversation = new InjectionToken<unknown>("conversation");

/** `ctx.fileUpload`（附件上传运行时：队列、上传控制面）。 */
export const FileUpload = new InjectionToken<unknown>("fileUpload");
