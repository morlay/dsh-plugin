import { provide } from "@morlay/zephyr";
import { ModelSelectionSlots } from "./model-selection-slots.ts";
import { SettingsGeneralSlots } from "./settings-general-slots.ts";
import { SettingsHost } from "./settings-host.ts";
import { SettingsModelsSlots } from "./settings-models-slots.ts";

/**
 * 设置的**浏览器半**：一份清单装完本包的前端面。
 *
 * 内部顺序：入口行（`configForms` / `settingsSchema` 的真实现）→ 页面位置（通用页 + 模型页）→
 * 输入区的模型选择器。
 *
 * 装配面要求：本函数必须排在 `provideClientChain()` **之后**（链内的 `Locale` / `Theme` 要 `configForms` 面），
 * 且建议排在 `provideSessions()` / `provideCommandUi()` 前后均可（那两行的依赖按服务名解析，不靠清单位置）。
 * 要剔某一行用 `without(实现类)`。
 */
export const provideSettingUi = provide([
  SettingsHost,
  SettingsGeneralSlots,
  SettingsModelsSlots,
  ModelSelectionSlots,
]);
