// 本包的浏览器半（`exports["./ui"]`）：permission 与 approval 两行都在这里。
//
// 上游 UI 组件没有导出，所以是 `fromCordis` 转发。
export * from "./permission-ui.provide.ts";
export * from "./ui-permission.service.ts";
export * from "./approval.provide.ts";
export * from "./approval.service.ts";
export { ApprovalSlot } from "./approval-slot.ts";
export { UserQuestionsSlots } from "./user-questions-slots.ts";
export { provideUserQuestionsSlots } from "./slots.provide.ts";
