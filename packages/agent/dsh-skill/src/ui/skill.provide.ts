import { provide } from "@morlay/zephyr";
import { SkillSlots } from "./skill-slots.ts";

/** skill 的浏览器半：会话内卡片与技能的展示面。 */
export const provideSkillUi = provide([SkillSlots]);
