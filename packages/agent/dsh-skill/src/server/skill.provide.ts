import { provide } from "@morlay/zephyr";
import { SkillCatalogRow, SkillEndpointDefault } from "@morlay/dsh-skill/server";
import { SkillFilesystem } from "../filesystem.service.ts";
import { ToolSkill } from "./tool-skill.service.ts";
import { SkillDefault } from "../skill.service.ts";

// 技能域一个 Module 装齐：注册表、工具行、`skills` 组的适配行与端点行。
//
// 装配位置**这一票不动**（注册表仍在应用根）：它内部按 `scopeOf(ctx)` 分层。按 scope 装配要连着
// 消费方（`ToolSkill` / `SkillCatalogRow` / `SkillFilesystem`）一起量，见设计记录的「迁移面」。
//
// 真机装配里 `provideApiSession()` 那行的 `SessionController` 会自己 `new SessionSkillCatalog(ctx)`，
// 与这里的适配行同名冲突——那种拓扑用 `provideSkill(without(SkillCatalogRow))`，端点行会从行 ctx
// 取上游实例（见 `skill-endpoint.service.ts`）。
export const provideSkill = provide([
  SkillDefault,
  ToolSkill,
  SkillCatalogRow,
  SkillEndpointDefault,
  // 文件系统来源：原来单独一个 `provideSkillFilesystem()`，装配面要写两行；现在是一个面一份清单。
  SkillFilesystem,
]);
