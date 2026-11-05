// 三份可覆盖的缺省清单：留什么、丢什么、换成什么文案。
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from "@morlay/dsh-agent/contract";
import { RULES_SECTION } from "./reminder.ts";

// 留在系统提示词里的 section：部署级 persona（子 agent 在 agent 作用域注册的同名 persona 也命中）、规则声明，
// 以及工具声明的两条载体。后者留着的理由：PTC 生效时 `tools:sdk` 是被换成**稳定骨架**的（字节不随工具集变），
// 降级成 reminder 反而每步都追加一条、破坏前缀缓存——前缀缓存正是 PTC 骨架存在的意义。
export const DEFAULT_KEEP: readonly string[] = [
  PERSONA_PREFIX_SECTION,
  PERSONA_SUFFIX_SECTION,
  RULES_SECTION,
  "tools:sdk",
  "tools:ptc-only",
];

// 不进提示词的 section：harness 自带的开场白与平台运维说明、本部署不装配的工具说明、平台外壳说明。
export const DEFAULT_SUPPRESS: readonly string[] = [
  "harness:identity",
  "harness:source",
  "app:web-surface",
  "tool:lsp",
  "tool:pty",
  "tool:session-query",
  "tool:cordis",
  "tool:ralph",
];

// 改写成中文的两段上游说明（内容忠实原意）。
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
