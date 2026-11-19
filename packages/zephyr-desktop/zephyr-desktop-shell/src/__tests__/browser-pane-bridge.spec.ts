import { describe, expect, it } from "vitest";
import { DESKTOP_IPC } from "../ipc.ts";
import { browserPaneBridgeOf, type BrowserPaneIpcLike } from "../browser-pane-bridge.ts";

const RECT = { x: 0, y: 0, width: 300, height: 200 };

/** 假 ipcRenderer：记通道与参数，并能让测试自己触发推送。 */
function fakeIpc(): BrowserPaneIpcLike & {
  readonly calls: string[];
  push(payload: unknown): void;
} {
  const calls: string[] = [];
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    calls,
    push: (payload) => listeners.get(DESKTOP_IPC.browserChanged)?.({} as never, payload),
    invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      calls.push(`${channel}:${JSON.stringify(args)}`);
      return { ok: true };
    },
    on: (channel, listener) => {
      listeners.set(channel, listener);
    },
    off: (channel) => {
      listeners.delete(channel);
    },
  };
}

describe("面板的 preload 桥（只转发，不做决策）", () => {
  it("五个意图各自落到自己的通道，参数原样过去", async () => {
    const ipc = fakeIpc();
    const bridge = browserPaneBridgeOf(ipc);
    await bridge.open({ id: "browser", url: "https://example.com/", bounds: RECT });
    await bridge.bounds("browser", RECT);
    await bridge.navigate("browser", "https://example.org/");
    await bridge.close("browser");
    await bridge.state("browser");
    expect(ipc.calls).toEqual([
      `${DESKTOP_IPC.browserOpen}:[{"id":"browser","url":"https://example.com/","bounds":{"x":0,"y":0,"width":300,"height":200}}]`,
      `${DESKTOP_IPC.browserBounds}:["browser",{"x":0,"y":0,"width":300,"height":200}]`,
      `${DESKTOP_IPC.browserNavigate}:["browser","https://example.org/"]`,
      `${DESKTOP_IPC.browserClose}:["browser"]`,
      `${DESKTOP_IPC.browserState}:["browser"]`,
    ]);
  });

  it("桥不判地址（非法地址也照样往主进程送：判据只有一处）", async () => {
    const ipc = fakeIpc();
    const bridge = browserPaneBridgeOf(ipc);
    await bridge.navigate("browser", "javascript:alert(1)");
    expect(ipc.calls).toEqual([`${DESKTOP_IPC.browserNavigate}:["browser","javascript:alert(1)"]`]);
  });

  it("state 订阅只有一条：主进程推 → 监听者收到；退订后不再收到", () => {
    const ipc = fakeIpc();
    const bridge = browserPaneBridgeOf(ipc);
    const seen: unknown[] = [];
    const off = bridge.subscribe((payload) => seen.push(payload));
    ipc.push({ id: "browser", state: { url: "https://example.com/" } });
    off();
    ipc.push({ id: "browser", state: { url: "https://example.org/" } });
    expect(seen).toEqual([{ id: "browser", state: { url: "https://example.com/" } }]);
  });
});
