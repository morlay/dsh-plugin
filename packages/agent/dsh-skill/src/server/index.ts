// skill 的**宿主半**（`@morlay/dsh-skill/server`）：适配行与 `skills` 组的端点行。
// 包根只出契约与 Module——server 实现不进包根（边界见 `.agents/standards/ui-module.md` 的「包出口」）。
export * from "../skill-catalog.row.ts";
export * from "./skill-endpoint.service.ts";
export * from "./tool-skill.service.ts";
export { provideSkillFilesystem } from "./filesystem.provide.ts";
export { provideSkill } from "./skill.provide.ts";
