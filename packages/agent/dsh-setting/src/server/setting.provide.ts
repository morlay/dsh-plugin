import { provide } from "@morlay/zephyr";
import { DeepseekLlmApiExtensionsDefault } from "../deepseek-llm-api-extensions.service.ts";
import { SettingEndpointDefault } from "./setting-endpoint.service.ts";
import { SettingLoader } from "../setting-loader.service.ts";
import { SettingSchema } from "../setting-schema.service.ts";
import { SettingDefault } from "../setting.service.ts";
import { LlmDeepseek } from "../llm-deepseek.service.ts";
import { LlmPiAi } from "../llm-pi-ai.service.ts";
import { UiSettingsPreferences } from "../ui-settings-preferences.service.ts";
import { UiThemeSchema } from "../ui-theme-schema.service.ts";

// 配置域的装配面：`/api` 的 provider 选项由这一行汇总。
// LLM provider 行：上游「API key 注册表」的实现，装了才有 provider 目录（设置里的「模型」页签读它）。
// 两条都装：它们是各自 namespace（`llm-deepseek` / `llm-pi-ai`）的注册者，键值是用户在设置里填的。
export const provideSetting = provide([
  // IO（读一次 / 串行落盘）与各 namespace 的配置 schema 注册表。
  SettingLoader,
  SettingSchema,
  // 配置文档（`<dataDir>/settings.json`）：两条 LLM 行在 `onInit` 里读它应用**持久化**配置，
  // 所以它必须排在它们前面（顺序即装配顺序）。
  SettingDefault,
  DeepseekLlmApiExtensionsDefault,
  LlmDeepseek,
  LlmPiAi,
  // 共享的「开发者工具」偏好（`ui-settings` 命名空间）：它决定主区有没有「轨迹」视图。
  UiSettingsPreferences,
  // `ui-theme` 的 durable schema（不是 provider：主题没有模型可选，但它的默认层必须由 schema 给出）。
  UiThemeSchema,
  // 配置文档的 wire 面。
  SettingEndpointDefault,
]);
