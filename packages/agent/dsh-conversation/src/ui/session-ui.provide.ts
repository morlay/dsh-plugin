import { provide } from "@morlay/zephyr";
import {
  AttachmentSlots,
  ChatSlots,
  FileActionsSlots,
  MessageQuotesSlot,
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
import { SessionStatusSlots } from "./session-status-slots.ts";

/** 会话界面的**壳**：`ui-session` 行（产出 `uiSession`）。 */
export const provideSessionShell = provide([SessionLayout]);

/** 未读标记那一行（产出 `uiSession.sessionStatus`）：要 `uiSession` 与 `remote.sessionStatus`。 */
export const provideSessionStatusUi = provide([SessionStatusSlots]);

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
  // 选中引用：两个槽位（`conversation.chat.text-interaction` / `conversation.user.text.node`）都由
  // 上面那两行声明，所以排在 `ConversationSlots` / `ChatSlots` 之后。
  MessageQuotesSlot,
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
