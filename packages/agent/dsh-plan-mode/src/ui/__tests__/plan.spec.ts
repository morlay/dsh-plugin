// @vitest-environment happy-dom
/**
 * plan-mode 域的浏览器半（`PlanSlots`）的装配闭环。
 *
 * 只假外部能力：真 `provideClientChain`（remote / locale / slots 的真实实现），本行 inject 的会话面与侧栏面换成
 * 记录器——上游 `ui-plan/client` 在 apply 里往会话事件面登记「计划提交」、往侧栏标签面登记一个 `plan` 标签页。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { provideClientChain, ConfigFormsInMemory, provideTheme } from "@morlay/zephyr-app/client";
import { SessionController, SidebarRight, SidebarRightTabs, UiConversation } from "@morlay/dsh-session/ui";
import { describe, expect, it } from "vitest";
import { PlanSlots } from "../plan-slots.ts";

const noop = (): void => {};

describe("plan-mode 域的浏览器半", () => {
  it("装完这一行，登记了计划事件与侧栏的 plan 标签页", { timeout: 20_000 }, async () => {
    const events: unknown[] = [];
    const tabs: unknown[] = [];
    const app = await bootstrapApplication({
      providers: [
      ...provideClientChain(),
      ...provideTheme(),
      
        ConfigFormsInMemory,
        PlanSlots,
        { provide: SessionController, useValue: { register: () => noop } },
        {
          provide: UiConversation,
          useValue: {
            events: { register: (definition: unknown) => (events.push(definition), noop) },
            userText: { register: () => noop },
            commands: { register: () => noop },
          },
        },
        { provide: SidebarRight, useValue: { register: () => noop } },
        { provide: SidebarRightTabs, useValue: { register: (tab: unknown) => (tabs.push(tab), noop) } },
      ],
      timeoutMs: 15_000,
    });
    try {
      expect(events).toEqual([expect.objectContaining({ kind: "submitted-plan" })]);
      expect(tabs).toEqual([expect.objectContaining({ kind: "plan" })]);
    } finally {
      await app.dispose();
    }
  });
});
