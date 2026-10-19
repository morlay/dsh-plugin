import { provide } from "@morlay/zephyr";
import { ApprovalSlot } from "./approval-slot.ts";
import { UserQuestionsSlots } from "./user-questions-slots.ts";

/**
 * permission 的两个**位置**：批准弹层（`approval`）与用户提问（`userQuestions`）。
 *
 * 与 `provideApproval()` / `providePermissionUi()` 分开：位置贡献要求会话界面已就位，装它们的人自己排序。
 */
export const provideUserQuestionsSlots = provide([ApprovalSlot, UserQuestionsSlots]);
