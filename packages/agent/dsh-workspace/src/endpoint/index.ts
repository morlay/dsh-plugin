// workspace 域的 **RPC 面**（`@morlay/dsh-workspace/endpoint`）：`workspace` 组的契约类（组名与方法名
// 的家）与另外两组的 deps 键 + 方法名。
export * from "./workspace.group.ts";
export * from "./workspace-files.group.ts";
export * from "./directory-picker.group.ts";
// 浏览器侧的数据面（`workspaces`）：`ui-workspace` 的每个入口都按它调，实现由 `ui/` 的组合服务给。
export * from "./workspace-controller.ts";
