// `<system-remainder>` 的边界：拼装稳定文本、只在变化时追加、空内容不追加。
import { describe, expect, it } from "vitest";
import { remainderChanged, remainderMessage, renderRemainder } from "../system-remainder.ts";

describe("renderRemainder", () => {
  it("按顺序拼 section，跳过空文本", () => {
    expect(
      renderRemainder([
        { name: "工具", text: "read：读文件" },
        { name: "技能", text: "   " },
        { name: "规则", text: "用中文" },
      ]),
    ).toBe("## 工具\n\nread：读文件\n\n## 规则\n\n用中文");
  });

  it("全空时是空串", () => {
    expect(renderRemainder([])).toBe("");
  });
});

describe("remainderChanged", () => {
  it("第一次有内容算变化", () => {
    expect(remainderChanged(undefined, "x")).toBe(true);
  });

  it("只有空白差异不算变化", () => {
    expect(remainderChanged("x\n", "x  ")).toBe(false);
  });

  it("内容不同算变化", () => {
    expect(remainderChanged("x", "y")).toBe(true);
  });
});

describe("remainderMessage", () => {
  it("包成一条带标签的 user 消息", () => {
    const message = remainderMessage("## 工具\n\nread");
    expect(message?.role).toBe("user");
    expect(message?.content).toEqual([
      { type: "text", text: "<system-remainder>\n## 工具\n\nread\n</system-remainder>" },
    ]);
  });

  it("空内容不产出消息", () => {
    expect(remainderMessage("   ")).toBeUndefined();
  });
});
