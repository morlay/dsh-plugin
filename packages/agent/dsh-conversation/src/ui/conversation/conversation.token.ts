// 会话域的跨行服务令牌：`uiConversation` 的 home 在框架层（技能、模型选择等域也要读它），
// `fileUpload` 归 upload 域。放这里就会让别的域反向依赖对话聚合层。
export { UiConversation } from "@morlay/zephyr-app/client";

// `FileUpload` 的令牌归 upload 域（服务由那一域的运行时提供），这里转出，行与本文件其余令牌一起用。
export { FileUpload } from "@morlay/dsh-upload/ui";
