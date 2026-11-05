import { provide } from "@morlay/zephyr";
import { ModelSelectionSlots } from "./model-selection-slots.ts";
import { SettingsGeneralSlots } from "./settings-general-slots.ts";
import { SettingsHost } from "./settings-host.ts";
import { SettingsModelsSlots } from "./settings-models-slots.ts";

/**
 * 设置的**入口行**：`configForms` / `settingsSchema` 的真实现。
 *
 * 单独成函数是为了让调用方把 `provideTheme()` 排在它**之后**、`provideSettingSlots()` **之前**：
 * `ui-theme` 在 apply 期同步读 `ctx.configForms`，读不到只订阅一次 `undefined`、不重试。
 */
export const provideSettingHost = provide([SettingsHost]);

/** 设置面板的页面位置（通用页 + 模型页）。 */
export const provideSettingSlots = provide([SettingsGeneralSlots, SettingsModelsSlots]);

/**
 * 输入区的模型选择器（上游 `ui-model-selection` client 半）。
 *
 * 要 `sessions` / `slots` / `locale` / `remote` 就位，所以装配面把它排在会话界面各行之后。
 */
export const provideModelSelectionSlots = provide([ModelSelectionSlots]);
