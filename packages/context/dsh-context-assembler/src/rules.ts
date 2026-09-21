import { RULES_SECTION } from "./reminder.ts";

/**
 * 覆盖规则的声明文本：写进**系统提示词**（不在 reminder 里重复），所以每条 reminder 只带 id 与正文。
 *
 * 为什么放系统提示词而不是首条 reminder：它是固定文本（不随会话变，不付缓存代价），而且放在这里
 * 才是系统级规则该在的位置——首条 reminder 自身会被压缩、被覆盖，权威性更低。
 */
export const RULES_TEXT = [
  "带 id 的 system-reminder 块是本系统提示词的一部分，持续有效：同 id 只有最新一条生效并取代更早的，不同 id 互不影响。",
  "skill_content 是要遵循的技能说明（随提示送来的与你后来加载的一样），file_content 是本步引用的文件内容。",
].join("");

export { RULES_SECTION };
