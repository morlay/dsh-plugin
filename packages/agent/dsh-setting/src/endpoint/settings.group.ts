// `settings` 组的**两端共用面**：组名、deps 键、方法名（与上游 `api/settings-controller` 的描述符一致）。

/** wire 上的组名。 */
export const SETTINGS_GROUP = "settings" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.settings`）。 */
export const SETTINGS_REMOTE_KEY = "remote.settings" as const;

/**
 * 组内的方法名（照上游 descriptor：`settings/describe` / `mutate` / `openSettingsDocument` /
 * `replace` / `update`）。
 *
 * **`set` / `unset` 不在这里**：那是 `credentials` 组的方法（凭证读写），归 `dsh-auth` 的端点面。
 */
export const SETTINGS_METHODS = {
  describe: "describe",
  mutate: "mutate",
  openSettingsDocument: "openSettingsDocument",
  replace: "replace",
  update: "update",
} as const;
