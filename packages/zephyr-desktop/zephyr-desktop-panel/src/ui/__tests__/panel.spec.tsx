// @vitest-environment happy-dom
// 判据：面板只发意图、只收主进程推的 state；矩形跟着布局走；关掉（卸载）就把 view 关掉并退订。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "@morlay/zephyr-desktop-panel/testing";
import {
  browserPaneOf,
  panelBoundsOf,
  type BrowserPaneBridgeLike,
  type PaneChange,
} from "../panel-bridge.ts";
import { PANEL_ID } from "../panel-slots.ts";
import { DesktopPanelBody } from "../panel.view.tsx";
// happy-dom 没有 ResizeObserver：面板只用它来收「矩形变了」，测试里给个空实现。
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
/** 假桥：记下每个意图，能让测试自己推 state。 */
function fakeBridge(): BrowserPaneBridgeLike & {
  readonly calls: string[];
  push(change: PaneChange): void;
  readonly unsubscribed: () => boolean;
} {
  const calls: string[] = [];
  let listener: ((change: PaneChange) => void) | undefined;
  let off = false;
  return {
    calls,
    push: (change) => listener?.(change),
    unsubscribed: () => off,
    open: async (input) => {
      calls.push(`open:${input.id}`);
      return { ok: true };
    },
    bounds: async (id, bounds) => {
      calls.push(`bounds:${id}:${String(bounds.width)}x${String(bounds.height)}`);
      return true;
    },
    navigate: async (id, url) => {
      calls.push(`navigate:${id}:${url}`);
      return url.startsWith("http")
        ? { ok: true }
        : { ok: false, reason: "面板只打开 http / https 地址" };
    },
    close: async (id) => {
      calls.push(`close:${id}`);
    },
    state: async () => undefined,
    subscribe: (next) => {
      listener = next;
      return () => {
        off = true;
      };
    },
  };
}
describe("面板矩形（panelBoundsOf）", () => {
  test("没有元素就不报（还没挂上）", () => {
    expect(panelBoundsOf(null)).toBeUndefined();
  });
  test("取整到像素（子像素进 view 会抖）", () => {
    const element = {
      getBoundingClientRect: () => ({ x: 10.4, y: 20.6, width: 300.5, height: 200.4 }),
    };
    expect(panelBoundsOf(element as never)).toEqual({ x: 10, y: 21, width: 301, height: 200 });
  });
});
describe("面板桥的取用（browserPaneOf）", () => {
  test("非桌面宿主里没有桥（面板不渲染容器）", () => {
    expect(browserPaneOf({})).toBeUndefined();
  });
  test("有桥就原样拿到（判据不在这里）", () => {
    const bridge = fakeBridge();
    expect(browserPaneOf({ __DSH_BROWSER_PANE__: bridge })).toBe(bridge);
  });
});
describe("面板正文（假桥）", () => {
  test("挂载就开、卸载就关，并退订 state", async () => {
    const bridge = fakeBridge();
    const view = render(<DesktopPanelBody bridge={bridge} />);
    await waitFor(() => {
      expect(bridge.calls.some((call) => call === `open:${PANEL_ID}`)).toBe(true);
    });
    // 矩形也报了一次（0x0 在 happy-dom 里也是合法读数）。
    expect(bridge.calls.some((call) => call.startsWith(`bounds:${PANEL_ID}:`))).toBe(true);
    view.unmount();
    await waitFor(() => {
      expect(bridge.calls).toContain(`close:${PANEL_ID}`);
    });
    expect(bridge.unsubscribed()).toBe(true);
  });
  test("state 只有主进程推：推来的 url/title 显示出来，非法地址给原因", async () => {
    const bridge = fakeBridge();
    render(<DesktopPanelBody bridge={bridge} />);
    bridge.push({
      id: PANEL_ID,
      state: { url: "https://example.com/", title: "示例站", canGoBack: false, loading: false },
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("https://example.com/")).toBeDefined();
      expect(screen.getByText("示例站")).toBeDefined();
    });
    // 非法地址：主进程拒，面板显示原因（地址栏保留用户输入）。
    fireEvent.change(screen.getByLabelText("地址"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByText("打开"));
    await waitFor(() => {
      expect(screen.getByText(/只打开 http/)).toBeDefined();
    });
  });
});
