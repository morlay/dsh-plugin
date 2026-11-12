// 工具分组、按需判据与名单里的组引用：纯函数层面的判据。
import { describe, expect, it } from "vitest";
import { deniedByList, isOnDemandToolGroup, isProtectedTool, toolGroupOf } from "../shared.ts";

describe("按需判据", () => {
  it("只回答「正文要不要常驻注入」，与工具能不能调无关", () => {
    // `init` 的组：正文随系统提示注入。
    for (const group of ["fs", "shell", "ask", "skill", "code"]) {
      expect(isOnDemandToolGroup(group)).toBe(false);
    }
    // `on-demand` 的组：正文靠 describe_tool 现取。
    for (const group of ["plan", "swarm", "web-access", "mcp"]) {
      expect(isOnDemandToolGroup(group)).toBe(true);
    }
    // MCP server 的组在静态表里没有定义，一律按需。
    expect(isOnDemandToolGroup("mcp:agent-browser")).toBe(true);
    // 认不出的组名与兜底组按常驻处理。
    expect(isOnDemandToolGroup("other")).toBe(false);
    expect(isOnDemandToolGroup("onDemand")).toBe(false);
    expect(isOnDemandToolGroup("no-such-group")).toBe(false);
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
