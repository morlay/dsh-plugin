// session 座位的**接缝**判据：它交给渲染器的 `hookContext` 必须是完整九字段（`useTabInfo` 的输入）。
//
// 这条覆盖「GuideTitle 崩在 `useTabInfo is not a function`」的直接原因：hookContext 没传或不全。
// 端到端（真渲染器把 `tabInfoFactory` 绑成 `useTabInfo`）需要完整装配夹具，属于下一步。
// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { RightbarSession, type RightbarSessionProps } from "../shell/rightbar-session.view.tsx";

/** 一个会话的布局：单 pane、一个 guide tab、已展开。 */
const layout = {
  expanded: true,
  activePaneId: "p1",
  nodes: { p1: { kind: "pane", activeTabId: "t1" } },
  tabs: { t1: { id: "t1", kind: "guide", title: "右侧面板" } },
};

/**
 * 造 props：`useStore` 返回固定布局，`renderSlot` 记录每次调用的 opts。
 * @returns props 与调用记录。
 */
function propsOf() {
  const calls: {
    key: string;
    entryKey: string | undefined;
    hookContext: Record<string, unknown> | undefined;
  }[] = [];
  const props = {
    sessionId: "s1",
    useStore: ((select: (state: never) => unknown) => select({ bySession: { s1: { layout } } } as never)) as never,
    useTabNavigation: (() => () => undefined) as never,
    renderSlot: ((key: string, _owner: object, opts?: { entryKey?: string; hookContext?: Record<string, unknown> }) => {
      calls.push({ key, entryKey: opts?.entryKey, hookContext: opts?.hookContext });
      return null;
    }) as never,
    labels: { close: "关闭标签", empty: "空", unavailable: "没有正文" },
    select: vi.fn(),
    close: vi.fn(),
    shortcuts: [],
    occurrence: () => ({ signal: new AbortController().signal, actions: {} as never }),
    syncPresentation: vi.fn(),
  } satisfies Omit<RightbarSessionProps, never>;
  return { props, calls };
}

describe("session 座位的接缝", () => {
  test("正文与标题都带完整九字段的 hookContext，并用 kind 作 entryKey", () => {
    const { props, calls } = propsOf();
    render(<RightbarSession {...props} />);
    const body = calls.find(call => call.key === "sidebar.right.pane.tab");
    const title = calls.find(call => call.key === "sidebar.right.pane.tab.title");
    expect(body?.entryKey).toBe("guide");
    expect(Object.keys(body?.hookContext ?? {}).sort()).toEqual([
      "actions", "active", "fullscreen", "shortcuts", "signal", "tabId", "title", "useStore", "useTabNavigation",
    ]);
    expect(body?.hookContext?.fullscreen).toBe(false);
    expect(body?.hookContext?.active).toBe(true);
    expect(title?.hookContext?.title).toBe(true);
    expect(props.syncPresentation).toHaveBeenCalledWith(true);
    cleanup();
  });
});
