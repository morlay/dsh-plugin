// `workspaceFiles` 组的**两端共用面**：组名、deps 键、方法名（与上游 `api/workspace-files` 的描述符一致）。

/** wire 上的组名。 */
export const WORKSPACE_FILES_GROUP = "workspaceFiles" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.workspaceFiles`）。 */
export const WORKSPACE_FILES_REMOTE_KEY = "remote.workspaceFiles" as const;

/** 组内的方法名。 */
export const WORKSPACE_FILES_METHODS = {
  changes: "changes",
  list: "list",
  read: "read",
  readBytes: "readBytes",
  stat: "stat",
} as const;
