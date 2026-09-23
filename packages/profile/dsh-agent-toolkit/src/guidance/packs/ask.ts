/** 与用户交互。 */
import type { ToolPack } from "../types.ts";

export const ASK_PACK: ToolPack = {
  family: "ask",
  tools: [
  { tool: "ask_user_question", short: "向用户提问并等待回答" },
  ],
};
