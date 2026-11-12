// `describe_tool` 的边界：清单只列按需组；带组给 d.ts；常驻组与未知组给点名的话。
import { describe, expect, it } from "vitest";
import { describeTools, groupEntries } from "../ptc-describe.ts";

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
  it("不带 group 只列按需组，每条带一句话说明", () => {
    expect(describeTools(ENTRIES)).toBe(
      ["mcp:agent-browser — MCP · agent-browser", "web-access — 联网检索与抓取"].join("\n"),
    );
  });

  it("常驻组（fs）不进清单：它的签名已随系统提示注入", () => {
    expect(describeTools(ENTRIES)).not.toContain("fs");
  });

  it("带 group 给该按需组的 tools 成员声明", () => {
    const text = describeTools(ENTRIES, "web-access");
    expect(text).toContain("declare global {");
    expect(text).toContain("web_search(args: JsonValue): Promise<JsonValue>");
    expect(text).not.toContain("read(");
  });

  it("问常驻组时点名说明不需要 describe，不返回空串", () => {
    const text = describeTools(ENTRIES, "fs");
    expect(text).toContain("常驻组");
    expect(text).toContain("不需要 describe");
  });

  it("未知 group 给一句点名的话 + 可取组清单", () => {
    const text = describeTools(ENTRIES, "nope");
    expect(text).toContain("没有 nope 这个组");
    expect(text).toContain("web-access");
  });

  it("按需组被收窄空了时点名说明", () => {
    const text = describeTools(ENTRIES, "plan");
    expect(text).toContain("没有可用工具");
  });

  it("一个按需组都没有时给出明确说明", () => {
    const text = describeTools([{ name: "read", description: "读文件" }]);
    expect(text).toContain("当前会话没有按需组");
  });
});

describe("输出类型走 outputSchema 转换", () => {
  it("返回类型是该工具 outputSchema 转出来的 TS", () => {
    const text = describeTools(
      [
        {
          name: "web_fetch",
          description: "抓网页",
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { text: { type: "string" } },
          },
        },
      ],
      "web-access",
    );
    expect(text).toContain("web_fetch(args: JsonValue): Promise<{");
    expect(text).toContain("text?: string");
  });

  it("没有 outputSchema 时退回 JsonValue", () => {
    const text = describeTools([{ name: "web_fetch", description: "抓网页" }], "web-access");
    expect(text).toContain("web_fetch(args: JsonValue): Promise<JsonValue>");
  });
});

describe("参数类型走 parametersSchema 转换", () => {
  it("args 是具体参数类型，不是 JsonValue", () => {
    const text = describeTools(
      [
        {
          name: "web_fetch",
          description: "抓网页",
          parametersSchema: {
            type: "object",
            additionalProperties: false,
            properties: { url: { type: "string" }, offset: { type: "number" } },
            required: ["url"],
          },
        },
      ],
      "web-access",
    );
    expect(text).toContain("url: string");
    expect(text).not.toContain("args: JsonValue");
  });
});
