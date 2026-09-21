import { CHAT_ROWS } from "./chat.ts";
import { STANDARD_ROWS } from "./standard.ts";
import type { PresetRow } from "./rows.ts";

export interface PresetSource {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly order: number;
  readonly rows: readonly PresetRow[];
}

export const PRESET_SOURCES: readonly PresetSource[] = [
  {
    id: "standard",
    name: "标准模式",
    description: "功能完整的编码 Agent：文件、Shell、检索、联网等工具常驻，其余用法说明按需加载。",
    order: 1,
    rows: STANDARD_ROWS,
  },
  {
    id: "chat",
    name: "对话模式",
    description:
      "只做对话：提问与联网（搜索、抓取）三件工具，不注入系统提示词、工作区指令与技能目录。",
    order: 2,
    rows: CHAT_ROWS,
  },
];
