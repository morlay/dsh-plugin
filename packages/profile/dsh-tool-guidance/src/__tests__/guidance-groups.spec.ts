import { describe, expect, it } from "vitest";
import {
  BASE_GROUP_KEY,
  GROUP_KEYS,
  SHORT_TOOL_DESCRIPTIONS,
  TOOL_GROUPS,
  groupByKey,
  groupSkillBody,
  skillNameOf,
} from "../guidance/groups.ts";

describe("组表", () => {
  it("每个组都带中文名、skill 摘要与正文，且四组齐备", () => {
    expect(groupByKey(BASE_GROUP_KEY).title).toBe("基础");
    for (const key of GROUP_KEYS) {
      const group = groupByKey(key);
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.skillDescription.length).toBeGreaterThan(0);
      expect(group.lines.length).toBeGreaterThan(0);
      expect(group.tools.length).toBeGreaterThan(0);
    }
    expect(TOOL_GROUPS.map((group) => group.key)).toEqual([...GROUP_KEYS]);
    expect(skillNameOf("flow")).toBe("tool-group-flow");
  });

  it("base 的身份用组 key 表达（常驻注入只认它，不再有 `injection` 字段）", () => {
    expect(BASE_GROUP_KEY).toBe("base");
    expect(TOOL_GROUPS.filter((group) => group.key === BASE_GROUP_KEY)).toHaveLength(1);
    expect(groupByKey(BASE_GROUP_KEY).drops.length).toBeGreaterThan(0);
  });

  it("联网工具在 base 组：搜索与抓取是同一件事的两半", () => {
    expect(groupByKey("base").tools).toContain("web_search");
    expect(groupByKey("base").tools).toContain("web_fetch");
    expect(GROUP_KEYS).not.toContain("web");
  });

  it("丢弃清单里一个 section 只归一个组", () => {
    const owners = new Map<string, string[]>();
    for (const group of TOOL_GROUPS) {
      for (const name of group.drops) {
        owners.set(name, [...(owners.get(name) ?? []), group.key]);
      }
    }

    expect([...owners].filter(([, groups]) => groups.length > 1)).toEqual([]);
  });

  it("协作规则随 team 组一起丢弃：要点已写进它的正文", () => {
    expect(groupByKey("team").drops).toContain("team:policy");
    expect(groupSkillBody(groupByKey("team"))).toContain("只在用户明确要求时才招募队友");
  });

  it("team 组只列团队插件独有的工具（同名工具归派发组）", () => {
    const team = groupByKey("team");
    const delegation = groupByKey("delegation");

    expect(team.tools).toContain("spawn_teammate");
    // 子代理控制行也提供这三个同名工具：它们的说明归派发组，不进 team 组。
    for (const shared of ["send_message", "list_agents", "interrupt_agent"]) {
      expect(delegation.tools).toContain(shared);
      expect(team.tools).not.toContain(shared);
    }
  });

  it("派发组讲子代理（不是队友）：同名工具的说明归它", () => {
    const body = groupSkillBody(groupByKey("delegation"));

    expect(body).toContain("- subagent：派发子代理");
    expect(body).toContain("send_message：给子代理发消息");
    expect(body).not.toContain("队友");
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
});

describe("组 skill 正文", () => {
  it("是 markdown 列表：一行一条，直接讲怎么用", () => {
    const body = groupSkillBody(groupByKey("base"));

    expect(body.split("\n").every((line) => line.startsWith("- "))).toBe(true);
    expect(body).toContain("- read：读文本文件");
    expect(body).not.toContain("【基础】");
  });
});

describe("正文按可见工具修剪（base 常驻注入传的就是那份装配目录）", () => {
  it("只装了提问与联网三件时，讲别的工具的行消失", () => {
    // chat 形态：这个会话装配结果里就这三个工具。
    const visible = (tool: string): boolean =>
      ["ask_user_question", "web_search", "web_fetch"].includes(tool);
    const body = groupSkillBody(groupByKey("base"), visible);
    const lines = body.split("\n");

    expect(lines.some((line) => line.includes("web_search："))).toBe(true);
    expect(lines.some((line) => line.includes("web_fetch："))).toBe(true);
    expect(lines.some((line) => line.includes("ask_user_question："))).toBe(true);
    for (const gone of [
      "read：",
      "write：",
      "edit：",
      "glob：",
      "grep：",
      "bash：",
      "后台任务",
      "read_image：",
    ]) {
      expect(lines.some((line) => line.includes(gone))).toBe(false);
    }
  });

  it("不传谓词时是完整版（注册进官方目录的组用它）", () => {
    const body = groupSkillBody(groupByKey("base"));
    const lines = body.split("\n");

    expect(lines.length).toBeGreaterThan(5);
    expect(lines.some((line) => line.includes("read："))).toBe(true);
  });
});
