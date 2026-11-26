// @vitest-environment happy-dom
// 右栏 tab 的**两段式注册**判据：类型（本文件）与正文（视图）分开，缺任何一段都不报错——
// 「guide 里没入口」与「打开后空白」是两种完全不同的故障，排查时最容易只看一段。
import { bootstrapApplication } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import {
  ConfigFormsInMemory,
  SidebarRightTabs,
  SidebarRightTabsDefault,
  provideClientChain,
  provideTheme,
} from "@morlay/zephyr-app/client";
import { SessionModeLocales } from "../session-mode-locales.contribution.ts";
import { SessionModePanelTab } from "../session-mode-panel-tab.ts";
import { PANEL_ID } from "../session-mode-slots.ts";

describe("右栏 tab 的两段式注册", { timeout: 60_000 }, () => {
  test("类型注册上了，且 guide 页有入口", async () => {
    const app = await bootstrapApplication({
      providers: [
        ConfigFormsInMemory,
        ...provideClientChain(),
        ...provideTheme(),
        // 注册表本身：`SessionModePanelTab` 的 `tabs.register` 要求它先建出来。
        SidebarRightTabsDefault,
        SessionModeLocales,
        SessionModePanelTab,
      ],
      timeoutMs: 60_000,
    } as never);
    try {
      const tabs = app.get(SidebarRightTabs);
      expect(
        tabs.entries().map((entry) => entry.id),
        "类型没注册上：SessionModePanelTab.onInit 没跑（它 inject 的 SidebarRightTabs 要先建出来）",
      ).toContain(PANEL_ID);
      expect(
        tabs.face.guide().map((box) => box.providerId),
        "guide 页没有入口：register 缺 guide 字段——上游 guideEntries 只来自 definition.guide（tab-registry.ts:409-411），省略即『不上 guide 页』",
      ).toContain(PANEL_ID);
    } finally {
      await app.dispose();
    }
  });
});
