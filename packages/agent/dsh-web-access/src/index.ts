// web-access：`Web` 契约 + 两个实现（搜索、抓取）+ 装配模块 + 工具行。
export * from "./contract/index.ts";
export * from "./web.service.ts";
export * from "./web-search-deepseek.service.ts";
export * from "./web-fetch-http.service.ts";
// 工具行（`ToolWeb`）：装配层从这里拿，`./server` 那个子出口零消费方，已删。
export { ToolWeb } from "./server/tool-web.service.ts";
