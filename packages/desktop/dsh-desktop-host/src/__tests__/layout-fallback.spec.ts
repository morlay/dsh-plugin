// @vitest-environment jsdom
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_LAYOUT_FALLBACK_SCRIPT, applySidebarRailFallback } from "../layout-fallback.ts";

const HIDDEN_STYLE = "grid-template-columns: 0px minmax(0px, 1fr) 320px;";

function frame(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-sidebar-collapsed", "");
  element.setAttribute("style", HIDDEN_STYLE);
  document.body.append(element);
  return element;
}

function headerEntry(): void {
  const leading = document.createElement("div");
  leading.setAttribute("data-conversation-header-leading", "");
  const button = document.createElement("button");
  leading.append(button);
  document.body.append(leading);
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.platform;
});

describe("桌面侧边栏兜底", () => {
  it("注入形态（只带函数源码）自己就能跑：不引用模块作用域", () => {
    document.documentElement.dataset.platform = "darwin";
    const element = frame();
    // 与页面一致：在只有 document / MutationObserver 的上下文里执行，模块作用域不可见。
    expect(() => {
      runInNewContext(DESKTOP_LAYOUT_FALLBACK_SCRIPT, { document, MutationObserver });
    }).not.toThrow();
    expect(element.getAttribute("style")).toBe(
      "grid-template-columns: 56px minmax(0px, 1fr) 320px;",
    );
  });

  it("macOS 收起且没有会话头部入口时，把列宽留成 rail", () => {
    document.documentElement.dataset.platform = "darwin";
    const element = frame();
    applySidebarRailFallback(document);
    expect(element.getAttribute("style")).toBe(
      "grid-template-columns: 56px minmax(0px, 1fr) 320px;",
    );
  });

  it("有会话头部入口时保持官方的完全隐藏", () => {
    document.documentElement.dataset.platform = "darwin";
    const element = frame();
    headerEntry();
    applySidebarRailFallback(document);
    expect(element.getAttribute("style")).toBe(HIDDEN_STYLE);
  });

  it("非 macOS 与未收起时不碰列宽", () => {
    const element = frame();
    applySidebarRailFallback(document);
    expect(element.getAttribute("style")).toBe(HIDDEN_STYLE);
  });

  it("收起状态后出现时补 rail（React 重写 style 也会被重新纠正）", async () => {
    document.documentElement.dataset.platform = "darwin";
    const element = frame();
    applySidebarRailFallback(document);
    expect(element.getAttribute("style")).toContain("56px");

    element.setAttribute("style", HIDDEN_STYLE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.getAttribute("style")).toContain("56px");
  });
});
