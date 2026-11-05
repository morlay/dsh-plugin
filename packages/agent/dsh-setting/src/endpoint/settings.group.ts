// `settings` 组的**两端共用面**：组名、deps 键、方法名（与上游 `api/settings-controller` 的描述符一致）。

/** wire 上的组名。 */
export const SETTINGS_GROUP = "settings" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.settings`）。 */
export const SETTINGS_REMOTE_KEY = "remote.settings" as const;

/** 组内的方法名。 */
export const SETTINGS_METHODS = {
  describe: "describe",
  set: "set",
  unset: "unset",
} as const;
