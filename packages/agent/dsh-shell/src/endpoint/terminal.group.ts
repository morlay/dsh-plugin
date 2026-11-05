// `terminal` 组的**两端共用面**：组名、deps 键、方法名（与上游 `api/terminal-controller` 的描述符一致）。

/** wire 上的组名。 */
export const TERMINAL_GROUP = "terminal" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.terminal`）。 */
export const TERMINAL_REMOTE_KEY = "remote.terminal" as const;

/** 组内的方法名。 */
export const TERMINAL_METHODS = {
  attach: "attach",
  close: "close",
  create: "create",
  environment: "environment",
  list: "list",
  rename: "rename",
  retain: "retain",
  shells: "shells",
} as const;
