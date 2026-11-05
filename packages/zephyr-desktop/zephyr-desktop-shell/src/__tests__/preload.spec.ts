import { describe, expect, it } from "vitest";
import { markDocument } from "../document-marks.ts";

describe("页面侧的平台标记", () => {
  it("把平台与标题栏形态标到 <html data-*> 上（CSS 据此折叠侧栏顶部留白）", () => {
    const documentElement = { dataset: {} as Record<string, string | undefined> };
    markDocument({ documentElement }, "darwin");
    expect(documentElement.dataset).toEqual({ platform: "darwin", titlebar: "hidden" });
  });

  it("没有 documentElement 时静默（preload 在异常宿主里不该炸）", () => {
    expect(() => markDocument(undefined, "darwin")).not.toThrow();
  });
});
