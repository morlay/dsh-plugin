// 会话域的两个跨行服务令牌：`uiConversation`（装配面）与 `fileUpload`（附件上传运行时）。
//
// 它们由 `ui-conversation` 那一行内部创建，名字只在行作用域；别的行要按类型拿到，
// 就由本包的 `ConversationSlots` / `FileUploadRuntime` 把它们装成契约（`fromCordis` 的令牌）。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.uiConversation`（会话装配面：用户文本规则、绑定、视图）。 */
export const UiConversation = new InjectionToken<unknown>("uiConversation");

/** `ctx.fileUpload`（附件上传运行时：队列、上传控制面）。 */
export const FileUpload = new InjectionToken<unknown>("fileUpload");
