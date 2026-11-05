// @vitest-environment happy-dom
/**
 * 渲染冒烟：不启真浏览器，用 happy-dom 把「官方 client 链装配 → layout 注册 root → `UiRenderer.mount` →
 * `#root` 有内容」这段跑一遍。
 *
 * 这条用例的价值是**局部可调试**：真浏览器里 console 会被 HMR 客户端吞掉，而这里能直接断言 DOM。
 *
 * 它是 **slots 骨架的装配冒烟**（链装配 → root 注册 → mount），不是 apps 的整装组合——骨架能力归本包。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { SessionScopeContribution } from "../renderer/session-scope.contribution.ts";
import { describe, expect, it, vi } from "vitest";
import {
  ConfigFormsInMemory,
  Layout,
  Slots,
  UiRenderer,
  provideClientChain,
  provideLayout,
  provideTheme,
} from "@morlay/zephyr-app/client";

describe("渲染冒烟（happy-dom）", () => {
  it("官方链装配后 layout 注册 root slot，mount 出非空 #root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const container = document.getElementById("root");
    if (container === null) throw new Error("测试夹具缺 #root");

    const app = await bootstrapApplication({
      // 顺序即依赖：配置面 → 链（Locale 读 configForms）→ theme（读 configForms）→ layout（读 theme）。
      // 兜底贡献：没有业务 UI 行时提供 `session` scope 与 root 标准源。
      providers: [
        ConfigFormsInMemory,
        ...provideClientChain(),
        ...provideTheme(),
        ...provideLayout(),
        SessionScopeContribution,
      ],
      timeoutMs: 20_000,
    });
    let unmount: (() => void) | undefined;
    try {
      expect(app.tryGet(Layout), "Layout 契约应由 layout 行提供").toBeDefined();
      const slots = app.get(Slots);
      // `session` scope 与 root 标准源由业务行（`ui-session`）或兜底行提供：
      // 框架链只装渲染面，所以这条测试把兜底行一起装上（等价于「没有业务 UI 的最小装配」）。
      expect(slots.entries("root").length).toBeGreaterThan(0);
      // 先验 `renderSlot` 本身能出东西（它是 `UiRenderer.mount` 的唯一数据来源）。
      expect(slots.scope("session"), "session adapter 应已装（夹具的兜底行提供）").toBeDefined();
      const node = slots.renderSlot("root" as never, {});
      expect(node, "renderSlot('root') 应返回 React 树").toBeDefined();
      unmount = app.get(UiRenderer).mount(container);
      // React 的 createRoot 是异步提交：**等条件而不是等时间**——固定等一个宏任务在全仓并发下
      // 会变成「单跑绿、整批红」（本文件实测过）。
      await vi.waitFor(
        () => {
          expect(container.innerHTML.trim().length).toBeGreaterThan(0);
        },
        { timeout: 20_000, interval: 20 },
      );
      const html = container.innerHTML;
      // AppFrame 的 shell 层（layout 行的 root 注册真的渲染出来了，不是错误边界）。
      expect(html).toContain("data-shell-overlay");
      // 业务视图（`SessionListView`）住在应用层（`apps/*/src/client`），不在框架包；
      // 它自己的断言在应用的测试里，这条只守框架链的装配与渲染。
    } finally {
      // 先收 React 树再卸行：行先卸会把 root entry 撤掉，仍挂着的树重渲染时会抛「没有 root 注册」。
      unmount?.();
      await app.dispose();
    }
  }, 30_000);
});
