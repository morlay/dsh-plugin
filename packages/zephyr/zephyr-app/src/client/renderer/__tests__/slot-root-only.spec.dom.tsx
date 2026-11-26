// 判据：`@Slot({ root })` **单独声明**（不带 `scope`）时，root 标准源是否真的生效。
//
// 这条保护所有只用 root 贡献的行：`useSessions` / `useSessionStatus` 这类绑定拿不到时，
// 症状是 `useSessions is not a function`，与「接缝没接对」长得一样但根因完全不同。
// @vitest-environment happy-dom
import { bootstrapApplication } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { vi } from "vitest";
import {
  ConfigFormsInMemory,
  Slot,
  SlotContribution,
  Slots,
  UiRenderer,
  absentRootStandard,
  provideClientChain,
  provideLayout,
  provideTheme,
} from "@morlay/zephyr-app/client";

/**
 * 只装 session adapter 的行（不带 root）：`renderRoot` 无条件包 `<ScopeProvider scope="session-maybe">`，
 * 没有 adapter 它会抛 `SlotAssemblyError`、把 root 树换成空占位——这正是前几轮误判成
 * 「`@Slot({root})` 不支持」的原因。先装 adapter，才验得到 root 标准源能不能单独声明。
 */
/**
 * 本地最小 scope adapter：**框架测试的替身，故意不引业务实现**——
 * 这条验的是「框架能不能在没有业务的情况下渲染」，引了业务就成了验业务。
 * @returns 空绑定的 adapter。
 */
function scopeAdapter() {
  const binding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source = { getSnapshot: () => binding, subscribe: () => () => {} };
  return { current: source, bindingSource: () => source };
}

@Slot({ scope: { session: scopeAdapter() } })
class SessionOnly extends SlotContribution {}

/** 只声明 root 标准源（不声明 scope）的贡献行。 */
@Slot({ root: absentRootStandard })
class RootOnly extends SlotContribution {}

describe("root 标准源可以单独声明", { timeout: 30_000 }, () => {
  test("@Slot({ root }) 不带 scope 时，root 组件仍拿得到 useSessions", async () => {
    const errors: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    document.body.innerHTML = '<div id="root"></div>';
    const container = document.getElementById("root");
    if (container === null) throw new Error("夹具缺 #root");
    const app = await bootstrapApplication({
      providers: [
        ConfigFormsInMemory,
        ...provideClientChain(),
        ...provideTheme(),
        ...provideLayout(),
        SessionOnly,
        RootOnly,
      ],
      timeoutMs: 20_000,
    });
    let unmount: (() => void) | undefined;
    try {
      const slots = app.get(Slots);
      const tree = slots.renderSlot("root" as never, {}) as { props?: Record<string, unknown> };
      process.stderr.write("[probe] root kit keys=" + Object.keys(tree?.props ?? {}).join(",") + "\n");
      unmount = app.get(UiRenderer).mount(container);
      await vi.waitFor(
        () => {
          expect(container.innerHTML).toContain("data-shell-overlay");
        },
        { timeout: 15_000, interval: 20 },
      );
      expect(errors.filter(message => /useSessions is not a function/.test(message))).toHaveLength(0);
    } finally {
      unmount?.();
      consoleError.mockRestore();
      await app.dispose();
    }
  });
});
