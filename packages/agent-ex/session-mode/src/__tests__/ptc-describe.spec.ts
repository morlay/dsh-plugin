// `tools_describe` 的边界：按组给 d.ts，不带组给清单。
import { describe, expect, it } from "vitest";
import { describeTools, groupEntries } from "@morlay/session-mode";

const ENTRIES = [
  { name: "read", description: "读文件" },
  { name: "write", description: "写文件" },
  { name: "web_search", description: "搜网页" },
  { name: "mcp__agent-browser__open", description: "开网页" },
];

describe("groupEntries", () => {
  it("按工具组归并（与面板分组同一套）", () => {
    const groups = groupEntries(ENTRIES);
    expect([...groups.keys()].sort()).toEqual(["fs", "mcp:agent-browser", "web-access"]);
    expect(groups.get("fs")?.map((schema) => schema.name)).toEqual(["read", "write"]);
  });
});

describe("describeTools", () => {
  it("不带 group 给「分组 + 标题 + 一行判据」，模型据此选下一句查哪组", () => {
    const text = describeTools(ENTRIES, undefined, (key) =>
      key === "fs" ? { title: "文件", guideline: "读、写、改文件时用它。", body: "" } : undefined,
    );
    expect(text.split("\n")).toEqual([
      "fs — 文件：读、写、改文件时用它。",
      "mcp:agent-browser — MCP · agent-browser：工具说明",
      "web-access — 联网检索与抓取：工具说明",
    ]);
  });

  it("带 group 给该组的 tools 成员声明", () => {
    const text = describeTools(ENTRIES, "fs");
    expect(text).toContain("declare global {");
    expect(text).toContain("read(args: JsonValue): Promise<JsonValue>");
    expect(text).toContain("write(");
    expect(text).not.toContain("web_search");
  });

  it("带 group 时先给组正文（这正是取代「每组注册一个 skill」的那条路）", () => {
    const text = describeTools(ENTRIES, "fs", () => ({
      title: "文件",
      guideline: "读、写、改文件时用它。",
      body: "- 改文件前先读当前内容",
    }));
    expect(text.startsWith("- 改文件前先读当前内容")).toBe(true);
    expect(text).toContain("declare global {");
  });

  it("未知 group 给空串", () => {
    expect(describeTools(ENTRIES, "nope")).toBe("");
  });
});

describe("输出类型走 outputSchema 转换", () => {
  it("ToolOutputMap 里是该工具 outputSchema 转出来的 TS", () => {
    const text = describeTools(
      [
        {
          name: "read",
          description: "读文件",
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { text: { type: "string" } },
          },
        },
      ],
      "fs",
    );
    expect(text).toContain("read(args: JsonValue): Promise<{");
    expect(text).toContain("text?: string");
  });

  it("没有 outputSchema 时退回 JsonValue", () => {
    const text = describeTools([{ name: "read", description: "读文件" }], "fs");
    expect(text).toContain("read(args: JsonValue): Promise<JsonValue>");
  });
});

describe("参数类型走 parametersSchema 转换", () => {
  it("args 是具体参数类型，不是 JsonValue", () => {
    const text = describeTools(
      [
        {
          name: "read",
          description: "读文件",
          parametersSchema: {
            type: "object",
            additionalProperties: false,
            properties: { file_path: { type: "string" }, offset: { type: "number" } },
            required: ["file_path"],
          },
        },
      ],
      "fs",
    );
    expect(text).toContain("file_path: string");
    expect(text).not.toContain("args: JsonValue");
  });
});
