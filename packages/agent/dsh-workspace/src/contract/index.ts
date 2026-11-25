// workspace 域的契约面（`@morlay/dsh-workspace/contract`）：进程内的端口，不涉及 remote。
export * from "./directory-picker.contract.ts";
export * from "./workspace.contract.ts";
export * from "./workspace-id.ts";
// 上游 UI 行的契约不在这里：`UiWorkspace`（`ui-workspace` 那一行）归对话域的契约面
// （`@morlay/dsh-conversation/contract`）——本包只留数据面（注册表 / 存储 / 查询）。
