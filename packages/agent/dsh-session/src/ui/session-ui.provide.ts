import { provide } from "@morlay/zephyr";
import {
  AttachmentSlots,
  ChatSlots,
  DeliverablesSlots,
  FileUploadRuntime,
  ScheduleSlots,
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
  ConversationSlots,
  ToolSlots,
  AttachmentSlots,
  ChatSlots,
  DeliverablesSlots,
  ScheduleSlots,
  SecretMaskSlot,
  SubagentSlots,
  TrajectorySlot,
  WorkflowRunSlot,
]);

/** 输入区：附件运行时、触发器与 `@` 引用（要会话界面各行之后）。 */
export const provideSessionInputSlots = provide([
  FileUploadRuntime,
  InputTriggerSlot,
  // 命令 UI 行：`static inject` 的头一项是 `inputTriggers`，所以排在触发器之后。
  CommandUiSlot,
  ReferenceSlot,
]);
