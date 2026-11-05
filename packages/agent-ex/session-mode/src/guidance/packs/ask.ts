// 与用户交互。
import type { ToolGroup } from "../types.ts";

export const ASK_GROUP: ToolGroup = {
  key: "ask",
  title: "问答",
  injection: "init",
  guideline: "要向用户提一个必须由人定夺的问题（而不是自己猜）时用它。",
  lines: [
    {
      when: "ask_user_question",
      text: "ask_user_question：需要用户定夺时必须通过该工具询问，不要自己猜。",
    },
  ],
  drops: [],
  tools: [{ tool: "ask_user_question", short: "向用户提问并等待回答" }],
};
