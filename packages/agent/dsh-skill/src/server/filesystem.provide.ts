import { provide } from "@morlay/zephyr";
import { SkillFilesystem } from "../filesystem.service.ts";

// **单行别名**（保留的理由）：`__tests__/skill.spec.ts` 只装这一行（不要注册表与端点）。
// 正常装配用 `provideSkill()`，它已含这条；要剔别的东西用 `without(...)`。
export const provideSkillFilesystem = provide([SkillFilesystem]);
