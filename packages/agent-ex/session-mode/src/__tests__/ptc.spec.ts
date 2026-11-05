// PTC 生效时（执行器在场，判据见收口里那两行注释）`tools:sdk` 换成稳定骨架、按需组的工具说明不占 system。
// 判据本身不在纯函数里：它是「装配里出现 `tools:ptc-only` 这条执行器专属 section」，端到端用例在
// `session-mode.spec.ts` 的「PTC：由运行时事实触发」那一组。
import { describe, expect, it } from "vitest";
import { describeTools, groupEntries } from "@morlay/session-mode";
import { ptcSections, ptcSdkText } from "@morlay/session-mode";

const ENTRIES = [
  { name: "read", description: "读文件" },
  { name: "bash", description: "执行命令" },
  { name: "web_search", description: "搜网页" },
];

describe("tools:sdk 的替换", () => {
  const SECTIONS = [
    { name: "tools:ptc-only", text: "run_code 是唯一能直接调的工具" },
    { name: "tools:sdk", text: "interface ToolArgsMap { read: ... }" },
    { name: "tool:web_search", text: "上游对 web_search 的说明" },
    { name: "tool:read", text: "上游对 read 的说明" },
    { name: "deployment:persona-prefix", text: "你是一个助手" },
  ];

  it("骨架里只有 declare 与 describe_tool，不铺具体工具", () => {
    const result = ptcSections(SECTIONS, ["bash", "read", "run_code", "web_search"]);
    const sdk = result.find((section) => section.name === "tools:sdk");
    expect(sdk?.text).toContain("describe_tool(args: {");
    expect(sdk?.text).toContain("declare global {");
    expect(sdk?.text).not.toContain("ToolArgsMap");
    expect(sdk?.text).not.toContain("read(args");
  });

  it("骨架的 group 清单由可见工具现算", () => {
    const text = ptcSdkText(["bash", "read", "run_code", "web_search"]);
    expect(text).toContain('"fs"');
    expect(text).toContain('"shell"');
    expect(text).toContain('"web-access"');
  });

  it("按需组的工具说明不留在 system，常驻组照旧", () => {
    const result = ptcSections(SECTIONS, ["bash", "read", "run_code", "web_search"]);
    const names = result.map((section) => section.name);
    expect(names).not.toContain("tool:web_search");
    expect(names).toContain("tool:read");
    expect(names).toContain("deployment:persona-prefix");
  });

  it("不认识的 section 一律原样留着", () => {
    const result = ptcSections([{ name: "harness:identity", text: "x" }], ["read"]);
    expect(result).toEqual([{ name: "harness:identity", text: "x" }]);
  });
});

describe("describe_tool 的工具体", () => {
  it("按组归并（MCP 一个 server 一组）", () => {
    const groups = groupEntries([
      ...ENTRIES,
      { name: "mcp__agent-browser__open", description: "开网页" },
    ]);
    expect([...groups.keys()].sort()).toEqual(["fs", "mcp:agent-browser", "shell", "web-access"]);
    expect(groups.get("fs")?.map((entry) => entry.name)).toEqual(["read"]);
  });

  it("不带 group 给分组清单，带 group 给该组签名", () => {
    expect(describeTools(ENTRIES)).toContain("fs — 文件读写");
    const text = describeTools(ENTRIES, "fs");
    expect(text).toContain("read(args: JsonValue): Promise<JsonValue>");
    expect(text).not.toContain("web_search");
  });

  it("未知 group 给空串", () => {
    expect(describeTools(ENTRIES, "nope")).toBe("");
  });
});
