// 分组表：工具名 → 一行中文、组归属、常驻与否、组引用命中，以及 d.ts 的渲染形状。
import { describe, expect, it } from "vitest";
import {
  SHORT_TOOL_DESCRIPTIONS,
  TOOL_GROUPS,
  groupByKey,
  groupOfTool,
  groupSkillBody,
  groupTitleOf,
  renderToolKey,
  renderToolsDeclaration,
  skillNameOf,
} from "@morlay/session-mode";
import {
  deniedByList,
  groupRef,
  groupTools,
  isProtectedTool,
  isResidentToolGroup,
  refGroup,
  toolGroupLabel,
  toolGroupOf,
} from "@morlay/session-mode";

describe("组表数据", () => {
  it("九个组，key 与工具名都不重名", () => {
    expect(TOOL_GROUPS.map((group) => group.key)).toEqual([
      "fs",
      "shell",
      "web-access",
      "code",
      "ask",
      "skill",
      "plan",
      "swarm",
      "mcp",
    ]);
    const keys = new Set(TOOL_GROUPS.map((group) => group.key));
    expect(keys.size).toBe(TOOL_GROUPS.length);
    const tools = TOOL_GROUPS.flatMap((group) => group.tools.map((entry) => entry.tool));
    expect(new Set(tools).size).toBe(tools.length);
  });

  it("每个工具都有一行中文（模型看的短描述）", () => {
    for (const group of TOOL_GROUPS) {
      for (const entry of group.tools) {
        expect(SHORT_TOOL_DESCRIPTIONS[entry.tool], entry.tool).toBe(entry.short);
        expect(entry.short.length, entry.tool).toBeGreaterThan(0);
      }
    }
  });

  it("组名与显示名按 key 查得到；未知 key 抛", () => {
    expect(groupByKey("fs").title).toBe("文件");
    expect(groupTitleOf("web-access")).toBe("联网");
    expect(groupTitleOf("nope")).toBeUndefined();
    expect(() => groupByKey("nope")).toThrow(/unknown group/u);
  });
});

describe("组正文", () => {
  it("按可见性过滤行：依赖的工具不在就不列那一行", () => {
    const body = groupSkillBody(groupByKey("fs"), (tool) => tool === "read");
    expect(body).toContain("read：读文本文件");
    expect(body).not.toContain("bash");
    expect(body.split("\n")).toHaveLength(1);
  });

  it("数组 when 是任一存在即可", () => {
    const body = groupSkillBody(groupByKey("shell"), (tool) => tool === "job_list");
    expect(body).toContain("后台任务：");
  });

  it("不传可见性判据就是全列", () => {
    expect(groupSkillBody(groupByKey("ask"))).toContain("ask_user_question");
  });
});

describe("工具归属与组引用", () => {
  it("静态表认得的分组；MCP 一个 server 一组；其余兜底 other", () => {
    expect(toolGroupOf("read")).toBe("fs");
    expect(toolGroupOf("bash")).toBe("shell");
    expect(toolGroupOf("mcp__agent-browser__open")).toBe("mcp:agent-browser");
    expect(toolGroupOf("plan_mode")).toBe("other");
    expect(groupOfTool("read")).toBe("fs");
    expect(groupOfTool("plan_mode")).toBeUndefined();
  });

  it("常驻组按 injection 判：`on-demand` 的组与每个 MCP server 都不常驻", () => {
    expect(isResidentToolGroup("fs")).toBe(true);
    expect(isResidentToolGroup("plan")).toBe(false);
    expect(isResidentToolGroup("web-access")).toBe(false);
    expect(isResidentToolGroup("mcp:agent-browser")).toBe(false);
    expect(isResidentToolGroup("other")).toBe(true);
  });

  it("组引用的写法与还原", () => {
    expect(groupRef("fs")).toBe("group:fs");
    expect(groupRef("mcp:a")).toBe("mcp:a");
    expect(refGroup("group:fs")).toBe("fs");
    expect(refGroup("mcp:a")).toBe("mcp:a");
  });

  it("名单里写组 id 等于命中组内每一个工具，写具体名字只命中它自己", () => {
    expect(deniedByList(["group:fs"], "read")).toBe(true);
    expect(deniedByList(["group:fs"], "bash")).toBe(false);
    expect(deniedByList(["mcp:a"], "mcp__a__x")).toBe(true);
    expect(deniedByList(["read"], "write")).toBe(false);
  });

  it("组的显示名：MCP 带 server 名", () => {
    expect(toolGroupLabel("fs")).toBe("文件");
    expect(toolGroupLabel("mcp:a")).toBe("MCP · a");
  });
});

describe("按需组", () => {
  it("只收按需组：常驻组的工具不进这张表", () => {
    expect([
      ...groupTools([
        "read",
        "bash",
        "skill",
        "todo_write",
        "ask_user_question",
        "web_search",
        "mcp__a__x",
        "mcp__a__y",
      ]),
    ]).toEqual([
      ["group:plan", ["todo_write"]],
      ["group:web-access", ["web_search"]],
      ["mcp:a", ["mcp__a__x", "mcp__a__y"]],
    ]);
  });

  it("run_code 与 describe_tool 不可被收窄", () => {
    expect(isProtectedTool("run_code")).toBe(true);
    expect(isProtectedTool("describe_tool")).toBe(true);
    expect(isProtectedTool("read")).toBe(false);
  });
});

describe("d.ts 渲染", () => {
  it("合法标识符裸写，其余加引号", () => {
    expect(renderToolKey("read")).toBe("read");
    expect(renderToolKey("mcp__a__open-page")).toBe('"mcp__a__open-page"');
  });

  it("签名块是可合并的 interface，说明作 doc 注释", () => {
    const text = renderToolsDeclaration([
      { name: "read", args: "{ path: string }", output: "{ text: string }", doc: "读文件" },
    ]);
    expect(text).toContain("declare global {");
    expect(text).toContain("  interface ToolsSdk {");
    expect(text).toContain("/** 读文件 */");
    expect(text).toContain("read(args: { path: string }): Promise<{ text: string }>");
  });

  it("组 skill 的名字带前缀", () => {
    expect(skillNameOf("fs")).toBe("tool-group-fs");
  });
});
