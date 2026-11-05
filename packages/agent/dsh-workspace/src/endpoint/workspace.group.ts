// `workspace` 组的**两端共用面**：组名、deps 键、方法名（与上游 `api/workspace-controller` 的描述符一致）。

/** wire 上的组名。 */
export const WORKSPACE_GROUP = "workspace" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.workspace`）。 */
export const WORKSPACE_REMOTE_KEY = "remote.workspace" as const;

/** 组内的方法名。 */
export const WORKSPACE_METHODS = {
  archiveSession: "archiveSession",
  create: "create",
  delete: "delete",
  follow: "follow",
  initializeDefault: "initializeDefault",
  insertBefore: "insertBefore",
  insertSessionBefore: "insertSessionBefore",
  list: "list",
  pinSession: "pinSession",
  rename: "rename",
  unarchiveSession: "unarchiveSession",
  unpinSession: "unpinSession",
} as const;
