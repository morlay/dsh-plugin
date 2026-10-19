// 前端面的**装配入口**：只导出装配模块与跨包要用的契约。
//
// 子路径（`@morlay/zephyr-app/client/<domain>`）由 `exports` 的 `./client/*` 提供，
// 入口不 `export *` 一切——否则 bundler 会把没被引用的行也打进前端产物。
export * from "./module.ts";
export * from "../connection/contract.ts";
export * from "../remote.contract.ts";
export * from "./renderer/slots.contract.ts";
export * from "./renderer/ui-renderer.contract.ts";
export * from "./renderer/renderer.module.ts";
export * from "./locale/locale.contract.ts";
export * from "./shortcuts/shortcuts.contract.ts";
export * from "./theme/theme.contract.ts";
export * from "./layout/layout.contract.ts";
