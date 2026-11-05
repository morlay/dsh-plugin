// 对话域的 **RPC 面**（`@morlay/dsh-conversation/endpoint`）：组名 + deps 键 + 方法名。
//
// 会话那一组（`session`）的契约在 `@morlay/dsh-session/endpoint`（数据面的两端面），这里不重复声明；
// 命令组在 `@morlay/dsh-command/endpoint`、工作区文件组在 `@morlay/dsh-workspace/endpoint`。
// 本出口只放**归对话域**的那几组。
export * from "./tool-results.group.ts";
export * from "./file-references.group.ts";
export * from "./session-reference.group.ts";
