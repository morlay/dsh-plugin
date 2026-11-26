// 右栏端到端 · **装配级**：真 `provideSessionShell()`（真 adapter）+ 真 `RemoteDefault`（只换传输）。
//
// 验什么：两个座位各 1 条 + 渲染期四类崩溃分别 0（`slot entry crashed` / `useTabInfo` / React child /
// `SlotOwnershipError`）。**不验** `[data-sidebar-right-panel]`。
//
// 为什么停在装配级：panel 需要「有会话在屏」，而 `SessionController` 契约缺「当前会话」读面
// （`ui-session` 的 adapter 因此拿不到 selected）。补它 = 为一条夹具给契约开洞（产品侧无消费方，
// 真机已确认 panel 出现）。触发条件与不补的理由见 `zephyr/.agents/debts/20261126-SessionController缺当前会话读面.md`。
// @vitest-environment happy-dom
import { bootstrapApplication, without } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { vi } from "vitest";
import {
  ConfigFormsInMemory,
  ProjectionsDefault,
  RemoteDefault,
  Slots,
  UiRenderer,
  mockTransport,
  provideClientChain,
  provideLayout,
  provideSidebarRight,
  provideTheme,
} from "@morlay/zephyr-app/client";
import { provideSessionShell, provideSessionStatusUi, provideSessions } from "@morlay/dsh-conversation/ui";
import { RightbarSeats } from "../shell/rightbar-seats.ts";

/** 右栏需要的唯一一帧：`session/control` 的基线（空投影）。 */
async function* baselineFrames() {
  yield { type: "baseline", value: { projections: { s1: { asOfSeq: -1, values: {} } } } };
}

/**
 * 装配 + 挂载，按行序参数化（防「靠清单顺序碰巧对」）。
 * @param sessionShellFirst - `provideSessionShell()` 是否排在 `provideSessions()` 之前。
 * @returns 断言用的句柄与清理函数。
 */
async function mountRightbar(sessionShellFirst: boolean) {
  document.body.innerHTML = '<div id="root"></div>';
  const container = document.getElementById("root");
  if (container === null) throw new Error("夹具缺 #root");
  const errors: string[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const shell = [...provideSessionShell()];
  const app = await bootstrapApplication({
    providers: [
      ConfigFormsInMemory,
      ...provideClientChain(),
      ...provideTheme(),
      ...provideLayout(),
      // 真机同款：`ui-session` 需要的子服务行（缺它整段 apply 不执行）。
      ...provideSessionStatusUi(),
      ...provideSessions(without(ProjectionsDefault)),
      ...(sessionShellFirst ? shell : []),
      ...(sessionShellFirst ? [] : shell),
      ...provideSidebarRight(),
      RightbarSeats,
    ],
    timeoutMs: 30_000,
  } as never);
  // 只换传输（不替 Remote 的语义）。
  app.get(RemoteDefault).useTransport(
    mockTransport({
      // 帧信封照桥的输出（`{ ok, value }`），行标识字段是上游的 `sessionId`。
      "session/list": () => ({
        ok: true,
        value: { items: [{ sessionId: "s1", title: "会话一", updatedAt: 0 }] },
      }),
      "session/control": () => baselineFrames(),
    }) as never,
  );
  // 装配级判据**不需要**拉目录：`reconnect()` / `refresh()` 是为了「有会话在屏」（panel），
  // 而那条已移到真机验收（见 debts/20261126-SessionController缺当前会话读面.md）。
  // 这里只验「装配起来 + 渲染不崩」，所以不碰目录，也就不依赖 `remote.session` 的挂载时序。
  const slots = app.get(Slots);
  const unmount = app.get(UiRenderer).mount(container);
  return {
    app, slots, container, errors, unmount,
    dispose: async () => {
      unmount();
      consoleError.mockRestore();
      await app.dispose();
    },
  };
}

describe("右栏端到端（装配级）", { timeout: 60_000 }, () => {
  for (const sessionShellFirst of [true, false]) {
    test(`行序 ${sessionShellFirst ? "sessionShell 先" : "sessionShell 后"}：两个座位各 1 条，渲染期无崩溃`, async () => {
      const handle = await mountRightbar(sessionShellFirst);
      try {
        expect(handle.slots.entries("rightbar" as never).length, "rightbar 座位").toBe(1);
        expect(handle.slots.entries("rightbar.session" as never).length, "rightbar.session 座位").toBe(1);
        await new Promise(resolve => setTimeout(resolve, 800));
        const html = handle.container.innerHTML;
        expect(html, "root 树应渲染出来").toContain('data-slot="root"');
        expect(handle.errors.filter(m => /slot entry crashed/.test(m)), "slot entry crashed").toHaveLength(0);
        expect(handle.errors.filter(m => /useTabInfo is not a function/.test(m)), "useTabInfo").toHaveLength(0);
        expect(handle.errors.filter(m => /Objects are not valid as a React child/.test(m)), "React child").toHaveLength(0);
        expect(handle.errors.filter(m => /SlotOwnershipError/.test(m)), "SlotOwnershipError").toHaveLength(0);
      } finally {
        await handle.dispose();
      }
    });
  }
});
