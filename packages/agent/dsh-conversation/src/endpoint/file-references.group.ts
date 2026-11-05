// `fileReferences` 组的**两端共用面**：组名、deps 键、方法名。
//
// 输入框 `@` 的文件候选：上游是 `@deepseek-ai/dsh-api-session-controller` 那一族里的一个 namespace，
// 归对话域（会话界面的一部分）。

/** wire 上的组名。 */
export const FILE_REFERENCES_GROUP = "fileReferences" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.fileReferences`）。 */
export const FILE_REFERENCES_REMOTE_KEY = "remote.fileReferences" as const;

/** 组内的方法名。 */
export const FILE_REFERENCES_METHODS = { list: "list" } as const;
