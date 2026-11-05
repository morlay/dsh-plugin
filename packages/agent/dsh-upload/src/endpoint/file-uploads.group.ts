// `fileUploads` 组的**两端共用面**：组名、deps 键、方法名（与上游 `client/file-upload` 的描述符一致）。

/** wire 上的组名。 */
export const FILE_UPLOADS_GROUP = "fileUploads" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.fileUploads`）。 */
export const FILE_UPLOADS_REMOTE_KEY = "remote.fileUploads" as const;

/** 组内的方法名。 */
export const FILE_UPLOADS_METHODS = { upload: "upload" } as const;
