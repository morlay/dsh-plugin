import { provide, type ProviderList } from "@morlay/zephyr";
import { SkillCatalogRow, SkillEndpointDefault } from "@morlay/dsh-skill/server";
import { ToolSkill } from "./tool-skill.service.ts";
import { SkillDefault } from "../skill.service.ts";

// 技能域一个 Module 装齐：注册表、工具行、`skills` 组的适配行与端点行。
// server 实现从 `./server` 出口引（不写相对路径）；装配面只装这一个 Module。
const providers = (): ProviderList => [SkillDefault, ToolSkill, SkillCatalogRow, SkillEndpointDefault];

export const provideSkill = provide(providers());
