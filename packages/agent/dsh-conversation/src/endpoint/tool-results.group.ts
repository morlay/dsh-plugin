// `toolResults` 组的**两端共用面**：组名、deps 键、方法名。
//
// 上游是 `@deepseek-ai/dsh-client-ui-trajectory` 的 host 入口（轨迹视图要的工具结果流）；
// 宿主行随会话端点一起归对话域。

/** wire 上的组名。 */
export const TOOL_RESULTS_GROUP = "toolResults" as const;

/** 组在 `Remote` 面上的 deps 键（`remote.toolResults`）。 */
export const TOOL_RESULTS_REMOTE_KEY = "remote.toolResults" as const;

/** 组内的方法名。 */
export const TOOL_RESULTS_METHODS = { watch: "watch" } as const;
