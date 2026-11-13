import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW_SIZE, windowFrameOf, windowOptionsOf } from "../window.ts";

describe("窗口外观（无标题栏）", () => {
  it("macOS：hiddenInset + 红绿灯内缩 + 侧栏材质", () => {
    expect(windowFrameOf("darwin")).toMatchObject({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: "sidebar",
      backgroundColor: "#00000000",
    });
  });

  it("Windows：去边框 + overlay；Linux：只去边框", () => {
    expect(windowFrameOf("win32")).toMatchObject({ frame: false });
    expect(windowFrameOf("win32").titleBarOverlay).toBeDefined();
    expect(windowFrameOf("linux")).toMatchObject({ frame: false });
    expect(windowFrameOf("linux").titleBarOverlay).toBeUndefined();
  });
});

describe("窗口选项", () => {
  it("没有 desktop 段时给缺省尺寸，外观跟着平台走", () => {
    expect(windowOptionsOf(undefined, "darwin")).toMatchObject({
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      titleBarStyle: "hiddenInset",
    });
  });

  it("配置里的尺寸优先，缺的项回落到缺省", () => {
    const options = windowOptionsOf(
      { id: "ai.x", name: "X", window: { width: 900, height: 700 } },
      "darwin",
    );
    expect(options).toMatchObject({ width: 900, height: 700, minWidth: 800, minHeight: 600 });
  });

  it("有上次关窗的状态：位置与尺寸都从它来（配置尺寸只管第一次启动）", () => {
    const options = windowOptionsOf(
      { id: "ai.x", name: "X", window: { width: 900, height: 700 } },
      "darwin",
      { state: { bounds: { x: 40, y: 60, width: 1000, height: 640 }, maximized: false } },
    );
    expect(options).toMatchObject({ x: 40, y: 60, width: 1000, height: 640 });
  });

  it("没有状态就不给位置（让 Electron 自己居中）", () => {
    const options = windowOptionsOf(undefined, "darwin");
    expect(options.x).toBeUndefined();
    expect(options.y).toBeUndefined();
    expect(DEFAULT_WINDOW_SIZE).toEqual({ width: 1280, height: 800 });
  });

  it("渲染进程不拿 node 权限；有 preload 才挂桥", () => {
    // sandbox 关：ESM preload 与它不兼容（隔离由 contextIsolation + nodeIntegration:false 保证）。
    expect(windowOptionsOf(undefined, "darwin").webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    });
    expect(
      windowOptionsOf(undefined, "darwin", { preload: "/x/preload.mjs" }).webPreferences.preload,
    ).toBe("/x/preload.mjs");
  });
});
