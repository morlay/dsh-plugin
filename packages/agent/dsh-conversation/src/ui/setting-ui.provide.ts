import { provide } from "@morlay/zephyr";
import { ModelSelectionSlots } from "./model-selection-slots.ts";
import { SettingsGeneralSlots } from "./settings-general-slots.ts";
import { SettingsHost } from "./settings-host.ts";
import { SettingsModelsSlots } from "./settings-models-slots.ts";

/**
 * 设置的**入口行**（`configForms` / `settingsSchema` 的真实现，上游 `ui-settings` 的 client 行）。
 *
 * 装配顺序**不需要**调用方安排：内核按每行的 `inject` 声明做拓扑排序（提供者在消费者前，同层沿用
 * 清单顺序），所以 `Locale` / `Theme` 对 `ConfigForms` 的依赖会自动把本行排到它们前面。
 *
 * 与 `provideSettingUi()` 分成两条清单的理由是**职责与生命周期**：入口行装的是上游 client 行的服务面，
 * 页面位置装的是槽位（后者依赖 `commandUi` 等链内服务）。这是契约清晰化，不是顺序约束。
 */
export const provideSettingHost = provide([SettingsHost]);

/**
 * 设置的**页面位置与模型选择器**：通用页 / 模型页的槽位，以及输入区的模型选择器。
 *
 * 内部顺序：页面位置（通用页 + 模型页）→ 输入区的模型选择器（后者要 `commandUi` 有提供者）。
 *
 * 顺序同样由内核的拓扑排序决定（它读 `configForms` 与 `commandUi` 的面）；与其它清单的相对位置
 * 不靠清单位置。要剔某一行用 `without(实现类)`。
 */
export const provideSettingUi = provide([
  SettingsGeneralSlots,
  SettingsModelsSlots,
  ModelSelectionSlots,
]);
