import { provide } from "@morlay/zephyr";
import { ToolWeb } from "./tool-web.service.ts";

/**
 * 给 agent 的 `web_fetch` / `web_search` 工具行。
 *
 * 与 `provideWebAccess()` 分开：工具行要 `ToolRegistry` / `SystemPrompt`，那是 agent 栈的东西，
 * 而 `provideWebAccess()` 只是「搜索 + 抓取两个后端」，装它的人（含测试）不该被拽进 agent 栈。
 */
export const provideToolWeb = provide([ToolWeb]);
