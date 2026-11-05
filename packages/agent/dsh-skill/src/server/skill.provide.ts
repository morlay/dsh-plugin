import { Injectable, provide } from "@morlay/zephyr";
import { SkillCatalogRow, SkillEndpointDefault } from "@morlay/dsh-skill/server";
import { ToolSkill } from "./tool-skill.service.ts";
import { SkillDefault } from "../skill.service.ts";
import { AgentProviderGroup } from "@morlay/dsh-agent-contract";

// 技能域一个 Module 装齐：注册表、工具行、`skills` 组的适配行与端点行。
//
// 真机装配里 `provideApiSession()` 那行的 `SessionController` 会自己 `new SessionSkillCatalog(ctx)`，
// 与这里的适配行同名冲突——那种拓扑用 `provideSkill(without(SkillCatalogRow))`，端点行会从行 ctx
// 取上游实例（见 `skill-endpoint.service.ts`）。
/**
 * 本域按 agent 分层的条目：各域声明自己的，装配面只装 group（单一职责）。
 *
 * 这些插件**仍装在 root**：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开，
 * 需要的是"全局一份 + 分层"，不是"每个 agent 一份实例"。
 */
@Injectable({ multi: true })
export class SkillAgentGroup extends AgentProviderGroup {
  readonly entries = [SkillDefault];
}

export const provideSkill = provide([SkillAgentGroup, SkillDefault, ToolSkill, SkillCatalogRow, SkillEndpointDefault]);
