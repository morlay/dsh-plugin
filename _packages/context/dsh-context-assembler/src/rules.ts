import { RULES_SECTION } from "./reminder.ts";

// 覆盖规则的声明文本：写进**系统提示词**（不在 reminder 里重复），所以每条 reminder 只带 id 与正文。
// 放系统提示词是因为它是固定文本（不随会话变、不付缓存代价），且 reminder 会被压缩与覆盖、权威性更低。
// 官方那两行（工作区指令、技能目录）写的是**不带 id** 的块，所以声明按"带 id 看 id、其余按来源"说覆盖。
export const RULES_TEXT = [
  "system-reminder 与 skill_content 块是本系统提示词的一部分，持续有效：同一条内容的最新一条取代更早的（带 id 的块以 id 为准，其余按来源），不同来源互不影响。",
  "skill_content 是要遵循的技能说明（随请求送来的与你后来加载的一样），file_content 是本步引用的文件内容。",
].join("");

export { RULES_SECTION };
