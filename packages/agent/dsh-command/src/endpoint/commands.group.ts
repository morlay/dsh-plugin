// `commands` 组的**两端共用面**：组名、deps 键、方法名（与上游 `client/ui-commands` 的描述符一致）。

/** wire 上的组名。 */
export const COMMANDS_GROUP = "commands" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.commands`）。 */
export const COMMANDS_REMOTE_KEY = "remote.commands" as const;

/** 组内的方法名。 */
export const COMMANDS_METHODS = {
  list: "list",
  execute: "execute",
} as const;
