import { CHAT_PERSONA } from "./persona.ts";
import { channelGroup, CHAT_TOOLKIT_ROWS, contextChannel, row, type PresetRow } from "./rows.ts";

/**
 * 对话模式的装配行：**一行提示词都不注入**——没有 system-prompt、工作区指令、skill 目录、引用注入与
 * 工具用法分组，也没有文件系统 / shell / 委派工具。
 *
 * 最后一行收口工具范围：preset 只能决定"加什么"，管不了 host 层——`dsh.profile.bundles` 打开的 bundle
 * （例如实验性的 Agent Teams）会在 host 层插工具行，对所有 preset 一视同仁。说清"我只有这三个"，
 * 比逐个去堵"不要什么"稳。提示词这边只有 persona 一行：其余注入行（工作区指令、技能目录、用法分组）
 * 本模式都不装——通道组里只有它自己需要的那几件。
 */
export const CHAT_ROWS: readonly PresetRow[] = [
  // 一个助手：保留语言与思考纪律，没有 suffix。
  row("persona", { config: { ...CHAT_PERSONA } }),
  // 功能行只有这两件，清单同样归 `@morlay/dsh-agent-toolkit`。
  ...CHAT_TOOLKIT_ROWS,
  // 对话模式只要通道本身、工具收口与工具预处理三件：能力清单与各自的参数都写在这一行里。
  channelGroup([
    contextChannel({
      capabilities: ["assembler", "scope", "tool-guidance"],
      options: {
        scope: {
          allowTools: ["ask_user_question", "web_search", "web_fetch"],
          instructions: false,
          // 没有文件与 shell 工具，就不该收到"能改工作区哪些文件、要不要走审批"那两条 runtime context。
          runtimeContext: false,
        },
        // 复用工具预处理（描述汉化 + 剥掉参数说明）：这是所有模式都要的，与用法分组无关。
        "tool-guidance": { groups: false },
      },
    }),
  ]),
];
