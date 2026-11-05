// 技能加载。
import type { ToolGroup } from "../types.ts";

export const SKILL_GROUP: ToolGroup = {
  key: "skill",
  title: "技能",
  injection: "init",
  guideline: "「技能」这一组工具的用法；需要时加载它。",
  lines: [{ when: "skill", text: "skill：按需加载技能说明，再按它行事。" }],
  drops: [],
  tools: [{ tool: "skill", short: "按需加载技能说明" }],
};
