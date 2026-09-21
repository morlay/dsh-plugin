import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";
import { RULES_SECTION } from "./reminder.ts";

/**
 * 留在系统提示词里的 section：部署级 persona（子 agent 在 agent 作用域注册的同名 persona 也命中）
 * 与覆盖规则声明（[`rules.ts`](./rules.ts)）。
 */
export const DEFAULT_KEEP: readonly string[] = [
  PERSONA_PREFIX_SECTION,
  PERSONA_SUFFIX_SECTION,
  RULES_SECTION,
];

/**
 * 不进提示词的 section。两类：平台运维说明（讲 dev server / HMR / 本地 checkout 位置，
 * 与本部署的模型任务无关），以及本部署不装配的工具的用法说明。其余工具说明由各组
 * 回收进 skill 正文（`absorbs`），不在这一份里。
 */
export const DEFAULT_SUPPRESS: readonly string[] = [
  "harness:source",
  "app:web-surface",
  "tool:lsp",
  "tool:pty",
  "tool:session-query",
  "tool:cordis",
  "tool:ralph",
];

/**
 * 改写成中文的两段上游说明（内容忠实原意）：`@` 引用路径的语义、输出里的文件链接规范。
 *
 * 这两段注册在 agent 层（`context:file-reference`）与 host 层（`ui:deliverable-file-references`），
 * 注册层不归我们——所以在装配结果上换文本（不移除：内容要保留）。
 */
export const DEFAULT_REPLACE: Readonly<Record<string, string>> = {
  "context:file-reference":
    "以 @ 开头的词是用户显式引用的工作区路径，相对于工作区根。结尾带斜杠表示目录：需要时列目录内容。" +
    "其余是文件：需要内容时用 read 工具读取，不要在读取前声称自己已经看过。" +
    '用 @"..." 括住含空格的路径。',
  "ui:deliverable-file-references":
    "成功创建或修改文件后，在最终回复里点明主要产物。除命令、配置表达式与代码块之外，" +
    "每处提到已存在的文件都要链到它的完整路径（相对工作目录或绝对路径）；已知行号时在目标后加 " +
    "`#L24` 或 `#L24-L30`。链接文本用文件名或清晰别名，只加够区分的父目录，不要把完整路径放进标签；" +
    "默认只用文件名，需要精确位置时在标签后接 `:24` 或 `:24–30`（不带 `#` 或 `L`）。",
};
