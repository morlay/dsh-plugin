// 会话域用到的两个跨行令牌：`uiConversation` 的 home 在对话域契约面（技能等域也要读它，行与令牌同一个
// owner）；`fileUpload` 归 upload 域。
export { UiConversation } from "@morlay/dsh-conversation/contract";

// `FileUpload` 的**契约**归 upload 域（服务由那一域的运行时提供），这里转出，行与本文件其余令牌一起用。
export { FileUpload } from "@morlay/dsh-upload/ui";
