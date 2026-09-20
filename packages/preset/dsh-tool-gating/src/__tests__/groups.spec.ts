import { describe, expect, it } from "vitest";

const everything = (): boolean => true;
import {
  BASE_GROUP_KEY,
  ENABLE_TOOLS_NAME,
  GROUP_KEYS,
  IGNORED_SECTIONS,
  SHORT_TOOL_DESCRIPTIONS,
  TOOL_GROUPS,
  allowedToolNames,
  deniedToolReason,
  groupByKey,
  groupOfTool,
  guidanceOf,
  presentGroups,
  normalizeGroups,
} from "../groups.ts";

describe("档位", () => {
  it("基础组常驻，其余随启用", () => {
    expect(allowedToolNames([])).toEqual([...groupByKey(BASE_GROUP_KEY).tools]);
    expect(allowedToolNames(["web"])).toEqual([
      ...groupByKey(BASE_GROUP_KEY).tools,
      ...groupByKey("web").tools,
    ]);
  });

  it("归一化模型给出的组名：未知项丢弃、重复项去重、base 不算启用", () => {
    expect(normalizeGroups(["web", "web", "base", "nope", "team"])).toEqual(["web", "team"]);
  });

  it("未启用组的工具被拒，文案给出解锁路径；启用或基础组放行", () => {
    const reason = deniedToolReason([], "web_search");

    expect(reason).toContain("联网检索");
    expect(reason).toContain(ENABLE_TOOLS_NAME);
    expect(deniedToolReason([], "read")).toBeUndefined();
    expect(deniedToolReason(["web"], "web_search")).toBeUndefined();
  });

  it("未归组的工具一律放行：它们不归档位管", () => {
    expect(groupOfTool(ENABLE_TOOLS_NAME)).toBeUndefined();
    expect(groupOfTool("subagent")).toBeDefined();
    expect(deniedToolReason([], ENABLE_TOOLS_NAME)).toBeUndefined();
    expect(deniedToolReason([], "some_future_tool")).toBeUndefined();
  });
});

describe("说明", () => {
  it("上游逐个工具的说明一律被忽略，且清单静态（不随档位变）", () => {
    expect(IGNORED_SECTIONS).toContain("tool:read");
    expect(IGNORED_SECTIONS).toContain("tool:web_search");
    expect(IGNORED_SECTIONS).toContain("tool:subagent");
    // team:policy 注册在 agent 作用域，不能遮蔽（同层重名会让 session 创建失败）。
    expect(IGNORED_SECTIONS).not.toContain("team:policy");
    // 平台运维说明也不要：本地 checkout 位置、Web GUI / HMR 约定。
    expect(IGNORED_SECTIONS).toContain("harness:source");
    expect(IGNORED_SECTIONS).toContain("app:web-surface");

    // 计划模式规则是行为约束，不是用法说明。
    expect(IGNORED_SECTIONS).not.toContain("plan:policy");
    // 这两段要保留（只把文本换成中文），不能进遮蔽清单。
    expect(IGNORED_SECTIONS).not.toContain("context:file-reference");
    expect(IGNORED_SECTIONS).not.toContain("ui:deliverable-file-references");
  });

  it("按组使用提示：基础组常驻，其余随启用", () => {
    const base = guidanceOf([], everything).join("\n");

    expect(base).toContain("【基础】");
    expect(base).not.toContain("【联网检索】");

    const withWeb = guidanceOf(["web"], everything).join("\n");

    expect(withWeb).toContain("【基础】");
    expect(withWeb).toContain("【联网检索】");
    expect(withWeb).not.toContain("【协作编排】");
  });
});

describe("组表与短描述", () => {
  it("每个组都带中文名、用途与使用提示，且四组齐备", () => {
    expect(groupByKey(BASE_GROUP_KEY).title).toBe("基础");
    for (const key of GROUP_KEYS) {
      const group = groupByKey(key);
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.summary.length).toBeGreaterThan(0);
      expect(group.guidance.length).toBeGreaterThan(0);
      expect(group.tools.length).toBeGreaterThan(0);
    }
    expect(TOOL_GROUPS.map((group) => group.key)).toEqual([...GROUP_KEYS]);
  });

  it("每个归组的工具都有中文短描述", () => {
    const missing = TOOL_GROUPS.flatMap((group) => group.tools).filter(
      (tool) => SHORT_TOOL_DESCRIPTIONS[tool] === undefined,
    );

    expect(missing).toEqual([]);
  });

  it("短描述明显短于上游原描述的量级（只讲做什么）", () => {
    for (const [toolName, description] of Object.entries(SHORT_TOOL_DESCRIPTIONS)) {
      expect(description.length, toolName).toBeLessThanOrEqual(24);
    }
  });

  it("组与提示按实际存在的工具渲染（Agent Teams 开关的两种形态）", () => {
    const legacy = (name: string): boolean =>
      [
        "subagent",
        "subagent_fork",
        "list_subagent_models",
        "workflow",
        "send_message",
        "list_agents",
        "interrupt_agent",
      ].includes(name);
    const teams = (name: string): boolean =>
      [
        "spawn_teammate",
        "send_message",
        "list_agents",
        "wait_agent",
        "interrupt_agent",
        "team_task_create",
        "team_task_list",
        "team_task_get",
        "team_task_update",
        "workflow",
      ].includes(name);

    // 未装 Agent Teams：提示讲 subagent 一套；装了：提示讲 spawn_teammate 一套。
    const legacyText = guidanceOf(["team"], legacy).join("\n");
    expect(legacyText).toContain("派发子代理用 subagent");
    expect(legacyText).not.toContain("spawn_teammate");

    const teamsText = guidanceOf(["team"], teams).join("\n");
    expect(teamsText).toContain("派发队友用 spawn_teammate");
    expect(teamsText).not.toContain("派发子代理用 subagent");

    // presentGroups 只列本部署装了的组。
    expect(presentGroups(legacy).map((group) => group.key)).toContain("team");
    expect(presentGroups((name) => name === "read").map((group) => group.key)).toEqual(["base"]);
  });
});
