// 循环期的宿主面：装配函数（`provideAgentLoop()`）+ 端点实现。

// 执行器的具体实现（装配面要 `without(ToolExecutorNative)` 时按类定位）。
export { ToolExecutorNative } from "../tool-executor.service.ts";
export { provideSubagentEndpoints } from "./subagent.provide.ts";
