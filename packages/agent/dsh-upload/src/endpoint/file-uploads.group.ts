// `fileUploads` 组的**两端共用面**：组名与方法名（与上游 `client/file-upload` 的描述符一致）。

/** wire 上的组名（也就是 `remote.fileUploads` 那个 namespace）。 */
export const FILE_UPLOADS_GROUP = "fileUploads" as const;

/** 组内的方法名。 */
export const FILE_UPLOADS_METHODS = { upload: "upload" } as const;
