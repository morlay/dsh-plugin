// PTC SDK 文本：system 骨架恒定；分组声明由 describe(group) 现取。
import { describe, expect, it } from "vitest";
import {
  PTC_SDK_SKELETON,
  renderSkeleton,
  replaceToolsSdk,
  renderDescribe,
  renderTools,
  type PtcToolSchema,
} from "@morlay/session-mode";

const READ: PtcToolSchema = {
  name: "read",
  description: "读文件",
  args: "{ path: string }",
  output: "{ text: string }",
};

// MCP 的工具名带 `-`：裸写成函数声明就是非法 TS。
const MCP: PtcToolSchema = {
  name: "mcp__agent-browser__agent_browser_open",
  description: "打开网页",
  args: "{ url: string }",
  output: "unknown",
};

describe("system 骨架", () => {
  it("只声明 describe，不列具体工具", () => {
    expect(PTC_SDK_SKELETON).toContain("declare global {");
    expect(PTC_SDK_SKELETON).toContain("```ts");
    expect(PTC_SDK_SKELETON).toContain("run_code");
    expect(renderSkeleton(["fs", "web"])).toContain('group?: "fs" | "web"');
    // `run_code` 的说明与 JsonValue 由上游 section 承载，骨架不重复。
    expect(PTC_SDK_SKELETON).not.toContain("JsonValue");
    expect(PTC_SDK_SKELETON).not.toContain("function read");
  });

  it("tools 的类型是可合并的接口，索引访问才是唯一能表达非常规名字的形态", () => {
    expect(PTC_SDK_SKELETON).toContain("  interface ToolsSdk {");
    expect(PTC_SDK_SKELETON).toContain("  const tools: ToolsSdk");
    expect(PTC_SDK_SKELETON).not.toContain("namespace tools");
  });
});

describe("renderTools", () => {
  it("工具挂在 tools 的接口上，按名字排序，不带 jsdoc", () => {
    const text = renderTools([READ]);
    expect(text).toBe(
      [
        "```ts",
        "declare global {",
        "  interface ToolsSdk {",
        "    read(args: { path: string }): Promise<{ text: string }>",
        "  }",
        "}",
        "```",
      ].join("\n"),
    );
  });

  it("非常规名字写成带引号的键，并说明要用索引访问", () => {
    const text = renderTools([MCP]);
    expect(text).toContain(
      '"mcp__agent-browser__agent_browser_open"(args: { url: string }): Promise<unknown>',
    );
    // 裸写的函数声明会让模型照抄出 SyntaxError
    expect(text).not.toContain("function mcp__agent-browser");
    expect(text).toContain('tools["名字"](args)');
  });

  it("全是合法名字时不多说索引访问那句", () => {
    expect(renderTools([READ])).not.toContain("索引访问");
  });

  it("空组不渲染", () => {
    expect(renderTools([])).toBe("");
  });
});

describe("renderDescribe", () => {
  const groups = new Map<string, readonly PtcToolSchema[]>([
    ["fs", [READ]],
    ["web", []],
  ]);

  it("不带参数给分组清单", () => {
    expect(renderDescribe(groups)).toBe("fs\nweb");
  });

  it("带参数只给该组声明", () => {
    expect(renderDescribe(groups, "fs")).toContain("read(args:");
    expect(renderDescribe(groups, "nope")).toBe("");
  });
});

describe("replaceToolsSdk", () => {
  const sections = [
    { name: "tools:ptc-only", text: "x" },
    { name: "tools:sdk", text: "interface ToolArgsMap {}" },
  ];

  it("PTC 下换成稳定骨架", () => {
    const result = replaceToolsSdk(sections, renderSkeleton(["fs"]));
    expect(result[1]?.text).toContain("describe_tool(args: {");
    expect(result[1]?.text).not.toContain("ToolArgsMap");
  });
});

describe("section 与工具组一一对应", () => {
  it("describe 结果先给 section 文本，再给 ts 代码块", () => {
    const text = renderTools([{ ...READ, section: "## read\n\n读文件。" }]);
    expect(text.startsWith("## read")).toBe(true);
    expect(text).toContain("```ts");
    expect(text).toContain("read(args:");
  });
});
