// @vitest-environment happy-dom
// 装配级判据：`main` → `conversation.composer.bar` → `conversation.input.left` 这条**声明链**。
//
// 为什么逐段断言：只报最后一环时，真因可能在最上游——`main` 没声明，上游 ui-conversation 的整段
// `slots.inject('main', …)`（`apply.ts:573-585`）根本不执行，后两环连「表错了」都算不上。
// 每条断言的 message 就是 CI 红那一眼要的结论。
//
// 判据用 `Slots.declared()`（这个位置被声明过），不用 `keys()` / `snapshot()`：
// keys() 只记「被注册或查询碰过的 key」，snapshot() 只列**有 occupant** 的位置——本用例不注册任何
// 条目，两个 API 都会把「已声明」看成「没出现」，而这里问的恰恰是「声明发生了没有」。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import {
  ConfigFormsInMemory,
  SidebarRightDefault,
  Slots,
  provideClientChain,
  provideLayout,
  provideSidebarRight,
  provideTheme,
} from "@morlay/zephyr-app/client";
import { provideFileUploadUi } from "@morlay/dsh-upload/ui";
import { provideWorkspaceUi } from "@morlay/dsh-workspace/ui";
import {
  ConversationSlots,
  provideSessionShell,
  provideSessionStatusUi,
  provideSessions,
} from "../index.ts";
// `WorkspaceSlots` 不在 `ui` 包出口上（那是装配函数面），测试按相对路径取本包内部的适配行。
import { WorkspaceSlots } from "../shell/index.ts";

describe("会话界面的声明链", { timeout: 60_000 }, () => {
  test("main → composer.bar → input.left 逐段成立", async () => {
    const app = await bootstrapApplication({
      providers: [
        ConfigFormsInMemory,
        ...provideClientChain(),
        ...provideTheme(),
        // `main` 由上游 ui-layout 的 apply 声明（它的 children 表里）；我们的 `provideLayout()` 就是它。
        ...provideLayout(),
        ...provideSessions(),
        ...provideSessionStatusUi(),
        ...provideSessionShell(),
        // 右栏：工作区面的侧栏行按 sidebarRight 读它。
        ...provideSidebarRight(configure(SidebarRightDefault, { onScreenScope: "session" })),
        ...provideWorkspaceUi(),
        // 上游 ui-workspace 的适配行：它产出 `uiWorkspace`（被测行的 inject 里有它）。
        WorkspaceSlots,
        ...provideFileUploadUi(),
        // 被测的那一行：上游 ui-conversation 的 apply（它把 composer.bar 与 inputBarChildren 一起声明）。
        ConversationSlots,
      ],
      timeoutMs: 60_000,
    } as never);
    try {
      const slots = app.get(Slots);
      expect(
        slots.declared("main"),
        "缺 main：layout 行的 children 没声明它 → 上游 ui-conversation 整段 slots.inject('main') 不执行（后两环必然也缺，别在这里补断言）",
      ).toBe(true);
      expect(
        slots.declared("conversation.composer.bar"),
        "缺 conversation.composer.bar：上游 registerComposerBar 没跑（它挂在 inject('main') 的 generator 里）",
      ).toBe(true);
      expect(
        slots.declared("conversation.input.left"),
        "有 composer.bar 但缺 conversation.input.left：上游 inputBarChildren 表没带上这个 key（contract/slots.ts:675）",
      ).toBe(true);
    } finally {
      await app.dispose();
    }
  });
});
