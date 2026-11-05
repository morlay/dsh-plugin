// configurable-sandbox 的包根：契约 + 默认实现 + 装配模块（**不导出 default**）。
//
// 本包**只有宿主半**：没有浏览器面、不引 react / css。出口只有 `.`。
export * from "./contract/index.ts";
export * from "./rules.ts";
export * from "./containment.ts";
export * from "./dialects.ts";
export * from "./policy-text.ts";
export * from "./sandbox.service.ts";
export * from "./fs.service.ts";
export * from "./sandbox-file.service.ts";
export * from "./sandbox-rules.service.ts";
export * from "./runtime-contexts.service.ts";
export * from "./configurable-sandbox.provide.ts";
// 事件统一放在 `Events` 命名空间下：不与服务混在同一个出口里。
export * as Events from "./events.ts";
