// 对话域的**浏览器半**（`@morlay/dsh-conversation/ui`）：会话界面（布局、槽位、client 侧 controller）与它们的装配函数。
//
// 这一面原本在 `@morlay/dsh-session/ui`：界面属于对话域，所以整块搬到了这里（数据面留在 `dsh-session`）。
// 装配面只从这里取 `provideXxx`：清单顺序有语义（先 store 后槽位），别在应用里重排。
export * from "../contract/session-controller.contract.ts";
export * from "./session-controller.service.ts";
export * from "./sessions.provide.ts";
export { SessionLayout } from "./session-layout.ts";
export { UiSession } from "./ui-session.token.ts";
export { SidebarRight, SidebarRightTabs } from "./ports.ts";
export * from "./conversation/index.ts";
// 两端共用的 client 契约在 **contract** 面（别的域只引 contract，不引本包的 ui）。
export * from "../contract/conversation-client.contract.ts";
export * from "./input/index.ts";
export {
  provideSessionInputSlots,
  provideSessionShell,
  provideSessionSlots,
} from "./session-ui.provide.ts";
export { provideSessionShellSlots } from "./shell/index.ts";
// 本域浏览器面的**聚合入口**（一个面一个装配函数）：布局 + 侧栏骨架 + 会话界面 + 输入区。
export { provideConversationUi } from "./conversation-ui.provide.ts";

// 设置面板（模型选择 / 通用 / 外观）：界面属于会话域，数据面在 `@morlay/dsh-setting`。
export * from "./setting-ui.provide.ts";
export * from "./model-selection-slots.ts";
export * from "./settings-general-slots.ts";
export * from "./settings-models-slots.ts";
export * from "./settings-host.ts";
export * from "./ui-settings.token.ts";

// 权限 / 批准 / 用户提问的界面行。
export * from "./permission-ui.provide.ts";
export * from "./permission-slots.provide.ts";
export * from "./approval.provide.ts";
export * from "./approval.service.ts";
export * from "./approval-slot.ts";
export * from "./ui-permission.service.ts";
export * from "./user-questions-slots.ts";

// 交付物的浏览器半（注册进会话界面已声明的位置）。
export * from "./deliverable.provide.ts";
export * from "./deliverable.slot.ts";
