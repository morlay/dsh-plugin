// `TabHookContext` 的判据：九字段齐全 + 两处退化值显式钉住。
//
// 退化不是「随手写的默认值」：将来接全屏（`fullscreen`）或后台会话视图（`active`）时，这两条会先红，
// 提醒改这里以及上游 `visible` 判断的语义。
import { describe, expect, test } from "@morlay/zephyr/testing";
import type { ShortcutCatalogEntry } from "@deepseek-ai/dsh-client-shortcuts/client";
import type { TabHookInput } from "../tab-context.ts";
import { tabHookContextOf } from "../tab-context.ts";

/**
 * 造一个最小输入：`shortcuts` 用真类型的最小条目，`actions` / 两个 hook 只求过类型（用例只验形状）。
 * @returns 构造 `TabHookContext` 的输入。
 */
function input(): TabHookInput {
  const controller = new AbortController();
  const shortcut = { id: "page.refresh" } as ShortcutCatalogEntry;
  return {
    shortcuts: [shortcut],
    tabId: "t1",
    title: false,
    occurrence: { signal: controller.signal, actions: {} as TabHookInput["occurrence"]["actions"] },
    useStore: ((select: (state: never) => unknown) => select({} as never)) as unknown as TabHookInput["useStore"],
    useTabNavigation: (() => () => undefined) as unknown as TabHookInput["useTabNavigation"],
  };
}

describe("TabHookContext", () => {
  test("九个字段齐全，值来自输入", () => {
    const source = input();
    const context = tabHookContextOf(source);
    expect(Object.keys(context).sort()).toEqual([
      "actions", "active", "fullscreen", "shortcuts", "signal", "tabId", "title", "useStore", "useTabNavigation",
    ]);
    expect(context.tabId).toBe(source.tabId);
    expect(context.title).toBe(false);
    expect(context.signal).toBe(source.occurrence.signal);
    expect(context.shortcuts).toBe(source.shortcuts);
  });

  test("退化值显式钉住：fullscreen=false（不接全屏）、active=true（不保留后台视图）", () => {
    const context = tabHookContextOf(input());
    expect(context.fullscreen).toBe(false);
    expect(context.active).toBe(true);
  });
});
