// 工具分组与名单里的组引用：纯函数层面的判据（按需加载的控制工具已移除，PTC 下 run_code 即按需）。
import { describe, expect, it } from "vitest";
import { deniedByList, isProtectedTool, toolGroupOf } from "../shared.ts";
import { groupTools } from "../tool-groups.ts";

describe("按需工具分组", () => {
  it("只收按需组：常驻组（文件 / shell / 技能 / 流程）不进这张表", () => {
    expect([
      ...groupTools([
        "read",
        "bash",
        "skill",
        "todo_write",
        "ask_user_question",
        "web_search",
        "web_fetch",
        "workflow",
        "mcp__a__x",
        "mcp__a__y",
        "mcp__b__z",
      ]),
    ]).toEqual([
      ["group:plan", ["todo_write"]],
      ["group:web-access", ["web_search", "web_fetch"]],
      ["group:swarm", ["workflow"]],
      ["mcp:a", ["mcp__a__x", "mcp__a__y"]],
      ["mcp:b", ["mcp__b__z"]],
    ]);
  });
});

describe("工具按用途分组", () => {
  it("按用途分组，MCP 仍按 server 分组", () => {
    expect(toolGroupOf("read")).toBe("fs");
    expect(toolGroupOf("working_directory")).toBe("fs");
    expect(toolGroupOf("bash")).toBe("shell");
    expect(toolGroupOf("web_search")).toBe("web-access");
    expect(toolGroupOf("skill")).toBe("skill");
    expect(toolGroupOf("present")).toBe("plan");
    expect(toolGroupOf("todo_write")).toBe("plan");
    expect(toolGroupOf("ask_user_question")).toBe("ask");
    expect(toolGroupOf("plan_mode")).toBe("other");
    expect(toolGroupOf("schedule_task")).toBe("other");
    expect(toolGroupOf("spawn_teammate")).toBe("swarm");
    expect(toolGroupOf("wait_agent")).toBe("swarm");
    expect(toolGroupOf("interrupt_agent")).toBe("swarm");
    expect(toolGroupOf("workflow")).toBe("swarm");
    expect(toolGroupOf("get_goal")).toBe("plan");
    expect(toolGroupOf("update_goal")).toBe("plan");
    expect(toolGroupOf("mcp__agent-browser__open")).toBe("mcp:agent-browser");
  });
});

describe("名单里的组引用", () => {
  it("写组 id 等于命中组内每一个工具", () => {
    expect(deniedByList(["mcp:agent-browser"], "mcp__agent-browser__open")).toBe(true);
    expect(deniedByList(["mcp:agent-browser"], "mcp__agent-desktop__desktop_snapshot")).toBe(false);
    expect(deniedByList(["group:plan"], "schedule_task")).toBe(false);
    expect(deniedByList(["group:plan"], "todo_write")).toBe(true);
    expect(deniedByList(["group:fs"], "read")).toBe(true);
    expect(deniedByList(["group:fs"], "web_search")).toBe(false);
  });

  it("写具体工具名只命中它自己", () => {
    expect(deniedByList(["mcp__agent-browser__open"], "mcp__agent-browser__open")).toBe(true);
    expect(deniedByList(["mcp__agent-browser__open"], "mcp__agent-browser__click")).toBe(false);
  });
});

describe("MCP 资源三件与受保护工具", () => {
  it("资源三件是一组独立的组", () => {
    for (const name of ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]) {
      expect(toolGroupOf(name)).toBe("mcp");
    }
    // 具体 server 的工具仍归它自己那组。
    expect(toolGroupOf("mcp__agent-browser__open")).toBe("mcp:agent-browser");
  });

  it("run_code 与 describe_tool 不可被开关收窄", () => {
    expect(isProtectedTool("run_code")).toBe(true);
    expect(isProtectedTool("describe_tool")).toBe(true);
    expect(isProtectedTool("read")).toBe(false);
  });
});
