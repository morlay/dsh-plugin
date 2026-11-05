// setting 的**数据面**：`settings.json` 的读写与端点。
//
// 这里**不装任何 LLM provider**：那是 `@morlay/dsh-agent` 的装配。设置机制（schema 注册表、
// 配置文档）在 `@morlay/zephyr-app`；各域自己注册自己的设置项（主题、开发者工具偏好、LLM 行）。
export * from "./contract/index.ts";
export * from "./setting.service.ts";
export * from "./server/setting-endpoint.service.ts";
// 设置项的声明与挂载模板：属**设置机制**（本包自己的 `settingRow` 与外部使用者共用这一份）。
export { SettingDeclaration, settingRow } from "./setting.decorator.ts";
