// 覆盖规则的声明文本：写进**系统提示词**，所以每条 reminder 只带 id 与正文。
import { RULES_SECTION } from "./reminder.ts";

export const RULES_TEXT = [
  "system-reminder 块是本系统提示词的一部分，持续有效。有冲突遵循就近原则。",
].join("");

export { RULES_SECTION };
