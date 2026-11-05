import { provide } from "@morlay/zephyr";
import {
  AttachmentSlots,
  ChatSlots,
  FileActionsSlots,
  OpenInAppSlots,
  SecretMaskSlot,
  SubagentSlots,
  ConversationSlots,
  ToolSlots,
  TrajectorySlot,
  WorkflowRunSlot,
} from "./conversation/index.ts";
import { CommandUiSlot, InputTriggerSlot, ReferenceSlot } from "./input/index.ts";
import { SessionLayout } from "./session-layout.ts";

/** 会话界面的**壳**：侧栏骨架与右侧面板（依赖 `slots`，与会话数据面分开）。 */
export const provideSessionShell = provide([SessionLayout]);

/** 会话界面：主视图、内容渲染、会话内各领域的卡片。 */
export const provideSessionSlots = provide([
  // 这两行往**菜单表**里注册条目（`contextMenus.register`），必须排在会话界面之前：
  // 界面里的 trigger 在渲染期就要 `resolve(target)`，排后面会拿到空表（右键菜单是个空壳），
  // 右上角的 Open In 按钮也注册不到 `conversation.session.header.utilities` 上。
  FileActionsSlots,
  OpenInAppSlots,
  ConversationSlots,
  ToolSlots,
  AttachmentSlots,
  ChatSlots,
  SecretMaskSlot,
  SubagentSlots,
  TrajectorySlot,
  WorkflowRunSlot,
]);

/** 输入区：触发器与 `@` 引用（要会话界面各行之后）。附件上传运行时在 `@morlay/dsh-upload/ui`。 */
export const provideSessionInputSlots = provide([
  InputTriggerSlot,
  // 命令 UI 行：`static inject` 的头一项是 `inputTriggers`，所以排在触发器之后。
  CommandUiSlot,
  ReferenceSlot,
]);
