// 单层工具组：key / 工具名唯一、每组有中文名与 guideline、injection 只能是 init | on-demand、
// base 是唯一的常驻组，正文按可见工具过滤。
import { describe, expect, it } from "vitest";
import {
  SHORT_TOOL_DESCRIPTIONS,
  TOOL_GROUPS,
  TOOLS_SDK_INTERFACE,
  groupByKey,
  groupSkillBody,
  renderToolKey,
  renderToolsDeclaration,
  skillNameOf,
} from "@morlay/session-mode";
import { assertGroupsUnique } from "@morlay/session-mode";

describe("工具组表", () => {
  it("key 与工具名都唯一", () => {
    expect(() => {
      assertGroupsUnique();
    }).not.toThrow();
    expect(() => {
      assertGroupsUnique([
        { ...TOOL_GROUPS[0]!, key: "dup", tools: [] },
        { ...TOOL_GROUPS[0]!, key: "dup", tools: [] },
      ]);
    }).toThrow(/duplicate group key/);
  });

  it("每组都有中文名、guideline，且 injection 合法", () => {
    for (const group of TOOL_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.guideline.length).toBeGreaterThan(0);
      expect(["init", "on-demand"]).toContain(group.injection);
    }
  });

  it("init 组就是那几个基础域，其余按需", () => {
    const init = TOOL_GROUPS.filter((group) => group.injection === "init").map(
      (group) => group.key,
    );
    expect(init.sort()).toEqual(["ask", "code", "fs", "shell", "skill"]);
    const lazy = TOOL_GROUPS.filter((group) => group.injection === "on-demand").map(
      (group) => group.key,
    );
    expect(lazy.sort()).toEqual(["mcp", "plan", "swarm", "web-access"]);
  });

  it("每个工具都有中文短描述", () => {
    const missing = TOOL_GROUPS.flatMap((group) => group.tools).filter(
      ({ tool }) => (SHORT_TOOL_DESCRIPTIONS[tool] ?? "").length === 0,
    );
    expect(missing).toEqual([]);
  });

  it("组 skill 的名字带前缀", () => {
    expect(skillNameOf("fs")).toBe("tool-group-fs");
  });
});

describe("groupSkillBody", () => {
  it("按可见工具过滤正文行", () => {
    const fs = groupByKey("fs");
    const all = groupSkillBody(fs);
    const onlyRead = groupSkillBody(fs, (tool) => tool === "read");
    expect(onlyRead.length).toBeLessThan(all.length);
    expect(onlyRead).toContain("read：");
    expect(onlyRead).not.toContain("web_search：");
  });

  it("未知组抛错", () => {
    expect(() => groupByKey("nope")).toThrow(/unknown group/);
  });
});

// MCP 的工具名带 `-`：裸写成函数声明就是非法 TS，模型照抄会直接 SyntaxError。
describe("工具签名块", () => {
  it("合法标识符裸写，其余加引号", () => {
    expect(renderToolKey("read")).toBe("read");
    expect(renderToolKey("mcp__agent-browser__agent_browser_open")).toBe(
      '"mcp__agent-browser__agent_browser_open"',
    );
  });

  it("成员挂在可合并的接口上，非常规名字用索引访问", () => {
    const text = renderToolsDeclaration([
      { name: "read", args: "{ path: string }", output: "{ text: string }", doc: "读文本文件" },
      { name: "mcp__agent-browser__open", args: "{ url: string }", output: "unknown" },
    ]);
    expect(text).toBe(
      [
        "declare global {",
        `  interface ${TOOLS_SDK_INTERFACE} {`,
        "    /** 读文本文件 */",
        "    read(args: { path: string }): Promise<{ text: string }>",
        '    "mcp__agent-browser__open"(args: { url: string }): Promise<unknown>',
        "  }",
        "}",
      ].join("\n"),
    );
    expect(text).not.toContain("function ");
  });
});
