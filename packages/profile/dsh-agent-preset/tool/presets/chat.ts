import { CHAT_PERSONA } from "./persona.ts";
import { row, scopeRow, type PresetRow } from "./rows.ts";

/**
 * 对话模式的清单：同样只有提示词与开关——工具行由 profile 平面提供，这里把它收成三件，
 * 并关掉 instruction 与动态快照（没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"对它全是噪音）。
 */
export const CHAT_ROWS: readonly PresetRow[] = [
  // 一个助手：保留语言与思考纪律，没有 suffix。
  row("persona", { config: { ...CHAT_PERSONA } }),
  scopeRow({
    allowTools: ["ask_user_question", "web_search", "web_fetch"],
    instructions: false,
    runtimeContext: false,
  }),
];
