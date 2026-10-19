// @vitest-environment happy-dom
/**
 * goal 域的浏览器半（`GoalSlots`）的装配闭环。
 *
 * 只假外部能力：真 `provideClientChain`（remote / locale / slots 的真实实现），本行 inject 的会话面换成记录器
 * ——上游 `ui-goal/client` 在 apply 里往会话事件与用户文本规则上各登记一条。断言是「这两条真的登记上了」：
 * 上游组件不导出，装配面能守的就是这条接线。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { provideClientChain, ConfigFormsInMemory, provideTheme } from "@morlay/zephyr-app/client";
import { SessionController, UiConversation } from "@morlay/dsh-session/ui";
import { describe, expect, it } from "vitest";
import { GoalSlots } from "../goal-slots.ts";

const noop = (): void => {};

describe("goal 域的浏览器半", () => {
  it("装完这一行，往会话事件面与用户文本规则各登记一条", { timeout: 20_000 }, async () => {
    const events: unknown[] = [];
    const rules: unknown[] = [];
    const app = await bootstrapApplication({
      providers: [
      ...provideClientChain(),
      ...provideTheme(),
      
        ConfigFormsInMemory,
        GoalSlots,
        { provide: SessionController, useValue: { register: () => noop } },
        {
          provide: UiConversation,
          useValue: {
            events: { register: (definition: unknown) => (events.push(definition), noop) },
            userText: { register: (rule: unknown) => (rules.push(rule), noop) },
          },
        },
      ],
      timeoutMs: 15_000,
    });
    try {
      expect(events).toHaveLength(1);
      expect(rules).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "goal-command-input" });
    } finally {
      await app.dispose();
    }
  });
});
