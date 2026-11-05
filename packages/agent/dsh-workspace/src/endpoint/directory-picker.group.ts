// `directoryPicker` 组的**两端共用面**：组名、deps 键、方法名。

/** wire 上的组名。 */
export const DIRECTORY_PICKER_GROUP = "directoryPicker" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.directoryPicker`）。 */
export const DIRECTORY_PICKER_REMOTE_KEY = "remote.directoryPicker" as const;

/** 组内的方法名。 */
export const DIRECTORY_PICKER_METHODS = {
  createDirectory: "createDirectory",
  list: "list",
  pick: "pick",
} as const;
