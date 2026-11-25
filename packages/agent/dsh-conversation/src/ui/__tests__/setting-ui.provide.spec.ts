/**
 * 设置面的**两条清单**：入口行与页面位置分开，因为它们的顺序约束相反。
 *
 * - 顺序由内核拓扑排序保证（不靠清单位置）：`provideSettingHost()` 只出 `SettingsHost`（`configForms` / `settingsSchema` 的真实现），要在
 *   `provideClientChain()` **之前**装——链内的 `Locale` / `Theme` 在 apply 期同步读 `ctx.configForms`；
 * - `provideSettingUi()` 出页面位置与模型选择器（读 `configForms` 的面），要在链**之后**装。
 *
 * 这条判据曾经失守过：两条清单合成一个函数、被排在链之后，报 `没有提供者：config-forms`。
 */
import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { ModelSelectionSlots } from "../model-selection-slots.ts";
import { SettingsGeneralSlots } from "../settings-general-slots.ts";
import { SettingsSchemaDefault } from "@morlay/zephyr-app/client";
import { SettingsHost } from "../settings-host.ts";
import { SettingsModelsSlots } from "../settings-models-slots.ts";
import { provideSettingHost, provideSettingUi } from "../setting-ui.provide.ts";

describe("设置面的两条清单", () => {
  test("`provideSettingHost()` 只装入口行（提供 `configForms` / `settingsSchema`）", () => {
    // 入口面两行：上游行本身（`configForms`）+ `settingsSchema` 的令牌拥有者（上游 apply 顺手注册它，
    // 但装配预检早于 onInit，令牌条目只能由清单给）。
    expect(provideSettingHost()).toEqual([SettingsHost, SettingsSchemaDefault]);
    // 页面位置不许混进入口行：混进去就会把"链前"那条约束传染给槽位行。
    expect(provideSettingHost()).not.toContain(SettingsGeneralSlots);
    expect(provideSettingHost()).not.toContain(SettingsModelsSlots);
    expect(provideSettingHost()).not.toContain(ModelSelectionSlots);
  });

  test("`provideSettingUi()` 只装页面位置与模型选择器（链后）", () => {
    expect(provideSettingUi()).toEqual([
      SettingsGeneralSlots,
      SettingsModelsSlots,
      ModelSelectionSlots,
    ]);
    // 入口行不许混进来：它必须早于链，排在链后就是 `没有提供者：config-forms`。
    expect(provideSettingUi()).not.toContain(SettingsHost);
  });
});
