// `sessionReferenceResolver` 组的**两端共用面**：组名、deps 键、方法名。
//
// `@` 菜单的会话候选：上游是 `@deepseek-ai/dsh-session-reference`，归对话域（会话引用是对话界面的一部分）。

/** wire 上的组名。 */
export const SESSION_REFERENCE_GROUP = "sessionReferenceResolver" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.sessionReferenceResolver`）。 */
export const SESSION_REFERENCE_REMOTE_KEY = "remote.sessionReferenceResolver" as const;

/** 组内的方法名。 */
export const SESSION_REFERENCE_METHODS = { candidates: "candidates" } as const;
