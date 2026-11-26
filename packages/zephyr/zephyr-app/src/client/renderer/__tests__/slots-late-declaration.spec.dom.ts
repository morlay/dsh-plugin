// 判据：`slots.inject(key, () => register(...))` 在**声明晚到**时，会不会在声明出现后把注册装上。
//
// 这条守的是真机症状「正文没注册」的一个可能根因：位置声明由别的行提供（`RightbarSeat` 的 children），
// 而消费方（`ui-sidebar-terminal` 等）先跑。`slots.service.ts` 的注释说会订阅声明变化，这里验行为。
// @vitest-environment happy-dom
import { bootstrapApplication } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { vi } from "vitest";
import {
  ConfigFormsInMemory,
  Slots,
  provideClientChain,
  provideLayout,
  provideTheme,
} from "@morlay/zephyr-app/client";
import { SessionScopeContribution } from "../session-scope.contribution.ts";

describe("位置声明晚于注册", { timeout: 20_000 }, () => {
  test("先 inject 等声明、后注册声明方 → 等的那次注册会装上", async () => {
    const app = await bootstrapApplication({
      providers: [
        ConfigFormsInMemory,
        ...provideClientChain(),
        ...provideTheme(),
        ...provideLayout(),
        SessionScopeContribution,
      ],
      timeoutMs: 15_000,
    });
    try {
      const slots = app.get(Slots);
      // ① 声明还没到：先等它
      const undo = slots.inject("sidebar.right.pane.tab" as never, () =>
        slots.register({ name: "sidebar.right.pane.tab", key: "late" } as never, (() => null) as never),
      );
      expect(slots.entries("sidebar.right.pane.tab" as never).length, "声明未到时不该有注册").toBe(0);
      // ② 声明方出现（`shell.overlay` 由 layout 声明，这里注册一条带 children 的贡献）
      const undoDecl = slots.register(
        {
          name: "shell.overlay",
          id: "late-declaration",
          children: {
            "sidebar.right.pane.tab": { kind: "keyed", scope: "session" },
          },
        } as never,
        (() => null) as never,
      );
      // ③ 订阅声明变化 → 就绪即装（异步一拍）
      await vi.waitFor(
        () => {
          expect(slots.entries("sidebar.right.pane.tab" as never).length, "声明到了应装上").toBe(1);
        },
        { timeout: 5_000, interval: 10 },
      );
      undoDecl();
      undo();
    } finally {
      await app.dispose();
    }
  });
});
