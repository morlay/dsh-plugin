import { describe, expect, it } from "vitest";
import type { PaneRect } from "../browser-pane.ts";
import {
  BROWSER_PANE_PARTITION,
  panePermissionCheckHandlerOf,
  panePermissionRequestHandlerOf,
  webContentsPaneViewOf,
  type BrowserPaneElectronLike,
} from "../browser-pane-view.ts";

const RECT: PaneRect = { x: 10, y: 20, width: 400, height: 300 };

/** 假 view：记下被调了什么，不碰真 Electron（真件由真机验）。 */
interface FakeView {
  readonly webPreferences: Record<string, unknown>;
  readonly record: { url: string; bounds: PaneRect; closed: boolean };
  title: string;
  loading: boolean;
  back: boolean;
  windowOpen?: (details: { readonly url: string }) => { readonly action: string };
  readonly listeners: Map<string, (...args: never[]) => void>;
}

/** 假 electron：只记调用。 */
function fakeElectron(): BrowserPaneElectronLike & {
  readonly views: FakeView[];
  readonly handlers: { request?: unknown; check?: unknown; download?: unknown };
  readonly partitions: string[];
} {
  const views: FakeView[] = [];
  const handlers: { request?: unknown; check?: unknown; download?: unknown } = {};
  const partitions: string[] = [];
  class View {
    readonly webPreferences: Record<string, unknown>;
    readonly record = { url: "", bounds: RECT, closed: false };
    readonly listeners = new Map<string, (...args: never[]) => void>();
    title = "";
    loading = false;
    back = false;
    windowOpen?: (details: { readonly url: string }) => { readonly action: string };
    readonly webContents = {
      loadURL: async (url: string): Promise<void> => {
        this.record.url = url;
      },
      close: (): void => {
        this.record.closed = true;
      },
      isDestroyed: (): boolean => this.record.closed,
      getURL: (): string => this.record.url,
      getTitle: (): string => this.title,
      canGoBack: (): boolean => this.back,
      isLoading: (): boolean => this.loading,
      on: (event: string, listener: (...args: never[]) => void): void => {
        this.listeners.set(event, listener);
      },
      setWindowOpenHandler: (handler: (details: { readonly url: string }) => { readonly action: string }): void => {
        this.windowOpen = handler;
      },
    };

    constructor(options: { readonly webPreferences: Record<string, unknown> }) {
      this.webPreferences = options.webPreferences;
      views.push(this as unknown as FakeView);
    }

    setBounds(bounds: PaneRect): void {
      this.record.bounds = bounds;
    }
  }
  return {
    views,
    handlers,
    partitions,
    WebContentsView: View as unknown as BrowserPaneElectronLike["WebContentsView"],
    session: {
      fromPartition: (partition: string) => {
        partitions.push(partition);
        return {
        setPermissionRequestHandler: (handler: unknown) => {
          handlers.request = handler;
        },
        setPermissionCheckHandler: (handler: unknown) => {
          handlers.check = handler;
        },
        on: (event: string, listener: (...args: never[]) => void) => {
            if (event === "will-download") handlers.download = listener;
          },
        };
      },
    },
  };
}

describe("面板 view 的权限面", () => {
  it("独立分区 + 沙箱 + 无 preload + 无 node 集成", async () => {
    const electron = fakeElectron();
    const port = webContentsPaneViewOf({ electron, host: { add: () => undefined, remove: () => undefined } });
    await port.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    const options = electron.views[0]?.webPreferences ?? {};
    expect(BROWSER_PANE_PARTITION.startsWith("persist:")).toBe(true);
    expect(options.partition).toBe(BROWSER_PANE_PARTITION);
    expect(options.sandbox).toBe(true);
    expect(options.contextIsolation).toBe(true);
    expect(options.nodeIntegration).toBe(false);
    // **没有 preload**：面板里的页面拿不到壳的任何桥。
    expect("preload" in options).toBe(false);
  });

  it("权限请求一律拒、权限检查一律假、下载一律取消", () => {
    const granted: boolean[] = [];
    panePermissionRequestHandlerOf()(undefined, "media", (value) => granted.push(value));
    panePermissionRequestHandlerOf()(undefined, "notifications", (value) => granted.push(value));
    expect(granted).toEqual([false, false]);
    expect(panePermissionCheckHandlerOf()(undefined, "media", "https://example.com")).toBe(false);
    expect(panePermissionCheckHandlerOf()(undefined, "clipboard-read", "https://example.com")).toBe(false);
    expect(panePermissionRequestHandlerOf().length).toBe(3);
    void granted;
  });
});

describe("面板的 session 钩子", () => {
  it("权限钩子与下载钩子装在面板**自己的分区**上（不是主窗口那个）", () => {
    const electron = fakeElectron();
    webContentsPaneViewOf({ electron, host: { add: () => undefined, remove: () => undefined } });
    expect(electron.partitions).toEqual([BROWSER_PANE_PARTITION]);
    expect(electron.handlers.request).toBeDefined();
    expect(electron.handlers.check).toBeDefined();
    expect(electron.handlers.download).toBeDefined();
  });

  it("下载一律取消（will-download → preventDefault），落不了盘", () => {
    const electron = fakeElectron();
    webContentsPaneViewOf({ electron, host: { add: () => undefined, remove: () => undefined } });
    const prevented: boolean[] = [];
    const handler = electron.handlers.download as (...args: never[]) => void;
    handler({ preventDefault: () => prevented.push(true) } as never);
    expect(prevented).toEqual([true]);
  });
});

describe("面板适配器（假 electron）", () => {
  it("open 建 view 并加载；重复 open 不叠实例；setBounds / navigate 落到同一个 view", async () => {
    const electron = fakeElectron();
    const added: unknown[] = [];
    const port = webContentsPaneViewOf({
      electron,
      host: { add: (view) => added.push(view), remove: () => undefined },
    });
    await port.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    await port.open({ id: "browser", url: "https://example.org/", bounds: RECT });
    expect(electron.views).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(electron.views[0]?.record.url).toBe("https://example.com/");
    expect(electron.views[0]?.record.bounds).toEqual(RECT);
    port.setBounds("browser", { ...RECT, width: 500 });
    expect(electron.views[0]?.record.bounds.width).toBe(500);
    await port.navigate("browser", "https://example.net/");
    expect(electron.views[0]?.record.url).toBe("https://example.net/");
    expect(port.state("browser")?.url).toBe("https://example.net/");
  });

  it("页面要开新窗口一律拒（外链仍归系统浏览器）", async () => {
    const electron = fakeElectron();
    const port = webContentsPaneViewOf({ electron, host: { add: () => undefined, remove: () => undefined } });
    await port.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    expect(electron.views[0]?.windowOpen?.({ url: "https://example.org/" })).toEqual({ action: "deny" });
  });

  it("状态变化只从主进程推（onChange），四条事件都接上", async () => {
    const electron = fakeElectron();
    const changed: string[] = [];
    const port = webContentsPaneViewOf({
      electron,
      host: { add: () => undefined, remove: () => undefined },
      onChange: (id) => changed.push(id),
    });
    await port.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    const listeners = electron.views[0]?.listeners;
    expect([...(listeners?.keys() ?? [])].sort()).toEqual([
      "did-navigate",
      "did-start-loading",
      "did-stop-loading",
      "page-title-updated",
    ]);
    listeners?.get("did-navigate")?.();
    listeners?.get("page-title-updated")?.();
    expect(changed).toEqual(["browser", "browser"]);
  });

  it("页面要开新窗口：http(s) 交系统浏览器，然后仍拒；非法协议不外抛", async () => {
    const electron = fakeElectron();
    const opened: string[] = [];
    const port = webContentsPaneViewOf({
      electron,
      host: { add: () => undefined, remove: () => undefined },
      openExternal: (url) => opened.push(url),
    });
    await port.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    const handler = electron.views[0]?.windowOpen;
    expect(handler?.({ url: "https://example.org/a" })).toEqual({ action: "deny" });
    expect(handler?.({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(opened).toEqual(["https://example.org/a"]);
  });

  it("close 销毁 view 并从窗口摘掉；关一个没开的不报错", async () => {
    const electron = fakeElectron();
    const removed: unknown[] = [];
    const port = webContentsPaneViewOf({
      electron,
      host: { add: () => undefined, remove: (view) => removed.push(view) },
    });
    await port.close("nope");
    await port.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    await port.close("browser");
    expect(electron.views[0]?.record.closed).toBe(true);
    expect(removed).toHaveLength(1);
    expect(port.opened).toEqual([]);
    expect(port.state("browser")).toBeUndefined();
  });
});
