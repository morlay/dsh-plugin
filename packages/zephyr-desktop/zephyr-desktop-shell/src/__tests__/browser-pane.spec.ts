import { describe, expect, test } from "@morlay/zephyr/testing";
import {
  browserPaneRoutesOf,
  type BrowserPanePort,
  type PaneRect,
  type PaneState,
} from "../browser-pane.ts";
import { browserUrlAllowed } from "../browser-url.ts";

const RECT: PaneRect = { x: 10, y: 20, width: 400, height: 300 };

/**
 * @param result - 路由的返回。
 * @returns 被拒时的原因（放行时是空串）。
 */
function reasonOf(
  result: { readonly ok: true } | { readonly ok: false; readonly reason: string },
): string {
  return result.ok ? "" : result.reason;
}

/** 假适配器：只记调用，不碰 Electron（真适配器由真机验）。 */
function fakePort(): BrowserPanePort & {
  readonly calls: string[];
  readonly boundsOf: (id: string) => PaneRect | undefined;
} {
  const panes = new Map<string, { bounds: PaneRect; state: PaneState }>();
  const calls: string[] = [];
  return {
    calls,
    boundsOf: (id) => panes.get(id)?.bounds,
    get opened() {
      return [...panes.keys()];
    },
    async open(input) {
      calls.push(`open:${input.id}:${input.url ?? ""}`);
      panes.set(input.id, {
        bounds: input.bounds,
        state: { url: input.url ?? "", title: "", canGoBack: false, loading: false },
      });
    },
    setBounds(id, bounds) {
      calls.push(`bounds:${id}`);
      const pane = panes.get(id);
      if (pane !== undefined) pane.bounds = bounds;
    },
    async navigate(id, url) {
      calls.push(`navigate:${id}:${url}`);
      const pane = panes.get(id);
      if (pane !== undefined) pane.state = { ...pane.state, url };
    },
    async close(id) {
      calls.push(`close:${id}`);
      panes.delete(id);
    },
    state(id) {
      return panes.get(id)?.state;
    },
  };
}

describe("面板能浏览什么（browserUrlAllowed）", () => {
  test("只有 http / https 放行", () => {
    expect(browserUrlAllowed("https://example.com/a?b=1")).toBe(true);
    expect(browserUrlAllowed("http://127.0.0.1:3082/")).toBe(true);
  });

  test("执行/本地/内联一律拒（面板不是「在应用里跑任意内容」）", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<h1>x</h1>",
      "about:blank",
      "chrome://settings",
      "devtools://devtools",
      "not a url",
      "",
    ]) {
      expect(browserUrlAllowed(url)).toBe(false);
    }
  });
});

describe("面板的 IPC 路由（假适配器）", () => {
  test("开 → 报矩形 → 导航：调用按 id 落到同一个 pane", async () => {
    const port = fakePort();
    const routes = browserPaneRoutesOf({ port, partition: "persist:zephyr-browser" });
    expect(await routes.open({ id: "browser", url: "https://example.com/", bounds: RECT })).toEqual(
      { ok: true },
    );
    expect(port.opened).toEqual(["browser"]);
    routes.setBounds("browser", { ...RECT, width: 500 });
    expect(port.boundsOf("browser")?.width).toBe(500);
    expect(await routes.navigate("browser", "https://example.org/")).toEqual({ ok: true });
    expect(routes.state("browser")?.url).toBe("https://example.org/");
  });

  test("非法地址：拒并给出原因，当前页不变", async () => {
    const port = fakePort();
    const routes = browserPaneRoutesOf({ port, partition: "persist:zephyr-browser" });
    await routes.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    const rejected = await routes.navigate("browser", "javascript:alert(1)");
    expect(rejected.ok).toBe(false);
    expect(reasonOf(rejected)).toContain("http");
    expect(routes.state("browser")?.url).toBe("https://example.com/");
    // 一开始就给非法地址：不建 pane。
    const other = fakePort();
    const otherRoutes = browserPaneRoutesOf({ port: other, partition: "persist:zephyr-browser" });
    expect(
      await otherRoutes.open({ id: "b", url: "file:///etc/passwd", bounds: RECT }),
    ).toMatchObject({
      ok: false,
    });
    expect(other.opened).toEqual([]);
  });

  test("重复 open 不叠实例；关一个没开的什么都不做；两个 pane 不串", async () => {
    const port = fakePort();
    const routes = browserPaneRoutesOf({ port, partition: "persist:zephyr-browser" });
    await routes.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    await routes.open({ id: "browser", url: "https://example.org/", bounds: RECT });
    expect(port.calls.filter((call) => call.startsWith("open:browser"))).toHaveLength(1);
    await routes.close("nope");
    expect(port.calls).not.toContain("close:nope");
    await routes.open({ id: "second", url: "https://example.net/", bounds: RECT });
    routes.setBounds("second", { ...RECT, x: 0 });
    expect(port.boundsOf("browser")?.x).toBe(RECT.x);
    expect(port.boundsOf("second")?.x).toBe(0);
  });

  test("导航一个没开的 pane 就是拒（不偷偷建一个）", async () => {
    const port = fakePort();
    const routes = browserPaneRoutesOf({ port, partition: "persist:zephyr-browser" });
    expect((await routes.navigate("ghost", "https://example.com/")).ok).toBe(false);
    expect(port.opened).toEqual([]);
    expect(routes.state("ghost")).toBeUndefined();
  });
});
