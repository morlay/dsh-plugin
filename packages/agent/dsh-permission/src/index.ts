export * from "./contract/index.ts";
export * from "./permission-mode.ts";
// permission 的主面：三个 host 侧契约 + 默认实现与装配模块。
//
// 浏览器半（审批行、用户提问行）在 `./ui`，入口不聚合。
export * from "./user-question-queue.service.ts";
export * from "./approval.service.ts";
export * from "./permission.service.ts";
// `PermissionUiModule` 不在这里转出：它 `fromCordis` 的是上游 **client 插件**
// （`@deepseek-ai/dsh-client-ui-permission-presets`），连带 React 组件与 `*.css`——从包根走一遍，
// 任何 host 侧 `import "@morlay/dsh-permission"` 都会把浏览器栈拖进进程。
// 它是浏览器半，只在 `./ui` 出口里。

// 上游门面：消费方不直接引 `@deepseek-ai/dsh-permission-presets`，从本包取；同名契约由本包的显式导出覆盖（见上）。
export * from "@deepseek-ai/dsh-permission-presets";
