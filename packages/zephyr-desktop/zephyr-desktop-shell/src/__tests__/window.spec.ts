import { describe, expect, it } from "vitest";
import { windowFrameOf, windowOptionsOf } from "../window.ts";

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

  it("渲染进程不拿 node 权限；有 preload 才挂桥", () => {
    // sandbox 关：ESM preload 与它不兼容（隔离由 contextIsolation + nodeIntegration:false 保证）。
    expect(windowOptionsOf(undefined, "darwin").webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    });
    expect(windowOptionsOf(undefined, "darwin", "/x/preload.mjs").webPreferences.preload).toBe(
      "/x/preload.mjs",
    );
  });
});
