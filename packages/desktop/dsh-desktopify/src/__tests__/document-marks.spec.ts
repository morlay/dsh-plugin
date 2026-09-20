// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  WINDOWS_TITLEBAR_HEIGHT,
  markDocumentPlatform,
  markWindowsTitlebar,
  syncNativeTheme,
} from "../document-marks.ts";

describe("桌面文档标记", () => {
  it("macOS 打上 data-platform，客户端据此启用侧边栏顶部拖拽条与 logo 下沉", () => {
    markDocumentPlatform("darwin", document);
    expect(document.documentElement.dataset.platform).toBe("darwin");
  });

  it("Windows 打上 caption 标记与标题栏高度（其它平台不打）", () => {
    markWindowsTitlebar("linux", document);
    expect(document.documentElement.hasAttribute("data-windows-titlebar")).toBe(false);

    markWindowsTitlebar("win32", document);
    expect(document.documentElement.hasAttribute("data-windows-titlebar")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--dsh-windows-titlebar-height")).toBe(
      `${String(WINDOWS_TITLEBAR_HEIGHT)}px`,
    );
  });

  it("只有 macOS 把主题来源转发给主进程，且只在值变化时发", async () => {
    const sent: string[] = [];
    syncNativeTheme("win32", document, (source) => sent.push(source));
    document.documentElement.setAttribute("data-ds-theme-source", "dark");
    expect(sent).toEqual([]);

    syncNativeTheme("darwin", document, (source) => sent.push(source));
    expect(sent).toEqual(["dark"]);
    document.documentElement.setAttribute("data-ds-theme-source", "dark");
    await Promise.resolve();
    expect(sent).toEqual(["dark"]);
    document.documentElement.setAttribute("data-ds-theme-source", "light");
    await Promise.resolve();
    expect(sent).toEqual(["dark", "light"]);
  });
});
