// 应用壳：侧栏骨架与右侧面板。
//
// 它们是**应用级**的壳（不属于任何业务域），但提供的 `sidebarRight` / `sidebarRightTabs`
// 两个服务被会话界面消费——令牌由 `@morlay/dsh-session` 声明（依赖倒置），实现由这里装。
export { SidebarSlots } from "./sidebar-slots.ts";
export { SidebarRightSlots } from "./sidebar-right-slots.ts";
