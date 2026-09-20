import {
  BASE_GROUP_KEY,
  ENABLE_TOOLS_NAME,
  TOOL_GROUPS,
  groupByKey,
  presentGroups,
  type GroupKey,
  type ToolGroup,
} from "./groups.ts";

const ENABLED = "已启用";
const LOCKED = "尚未启用";

/**
 * 模型可见的能力目录，**按档位分批**：已启用的组给出用途与成员工具，未启用的组只留
 * 组 key、标题与一句话用途（够模型判断该不该启用，但不把成员摊开）。
 *
 * 组与成员工具都按**本部署实际装了什么**过滤：官方 Agent Teams 的 bundle 开关会换掉委派
 * 工具（`subagent*` ↔ `spawn_teammate` / `team_task_*`），没装的组不再出现在目录里。
 */
export function renderCatalog(
  unlocked: readonly GroupKey[],
  exists: (name: string) => boolean,
): string {
  const isEnabled = (key: GroupKey): boolean => key === BASE_GROUP_KEY || unlocked.includes(key);
  const toolsOf = (group: ToolGroup): string[] => group.tools.filter(exists);
  const groups = presentGroups(exists);
  const enabled = groups.filter((group) => isEnabled(group.key));
  const locked = groups.filter((group) => !isEnabled(group.key));

  const lines = ["本会话的能力组与当前档位（工具目录始终列出全部工具，档位决定能调用哪些）：", ""];
  for (const group of enabled) {
    lines.push(`- ${group.title}（${group.key}）${ENABLED}：${group.summary}`);
    lines.push(`  工具：${toolsOf(group).join("、")}`);
  }
  if (locked.length > 0) {
    lines.push(
      "",
      `${LOCKED}的组（调用会被拒绝；需要时用 ${ENABLE_TOOLS_NAME} 一次性启用，或用户直接切换）：`,
    );
    for (const group of locked) {
      lines.push(`- ${group.key} ${group.title}：${group.summary}`);
    }
  }
  lines.push("", "启用某一组后，它的成员工具、用途与用法提示会一起补上。");
  return lines.join("\n");
}

/**
 * 用中文重写两段上游说明（内容忠实原意）：`@` 引用路径的语义、输出里的文件链接规范。
 *
 * 这两段注册在 agent 层（`context:file-reference`，file-reference-local）与 host 层
 * （`ui:deliverable-file-references`，ui-deliverables），注册层不归我们——所以改**装配投影**
 * 里的文本：不注册同名 section（agent 层同层重名会让装配失败）、也不遮蔽（内容要保留）。
 *
 * 改投影要求本插件在 `system-prompt/assemble` 链里位于 prompt-reminder 的**内层**（更晚注册），
 * 否则 reminder 捕获的是英文原文。装配顺序保证这一点（prompt-reminder 是 profile 的 host 行、
 * 先装载；本插件在 preset composition 里、后装载），并有测试断言 reminder 里出现中文。
 */
export const REPLACED_SECTION_TEXTS: Readonly<Record<string, string>> = {
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

/** Agent Teams 协作规则的 section 名：`tool-agent-team` 注册在 agent 作用域，只能改投影。 */
export const TEAM_POLICY_SECTION = "team:policy";

/**
 * 那段规则的中文版（要点不变：只在明确要求时招募、写范围互不重叠、任务板工作流、Lead 等齐队友）。
 * 只在 team 组启用时给；未启用时置空，等于不注入。
 */
export const TEAM_POLICY_TEXT = [
  "【Agent Teams 规则】只在用户明确要求时才招募队友。",
  "Lead 与队友共享同一工作目录与文件系统，改动彼此立即可见：把写工作按互不重叠的范围分给各成员，",
  "并在共享任务里记下预期写范围；范围重叠只是提示、不是锁。",
  "改文件优先用 read/edit/write；遇到 FS_STALE_VERSION 时先读回当前内容、把改动重贴到新内容上再重试。",
  "bash、格式化器、代码生成器与脚本不受文件版本守卫保护：要显式协调，并由 Lead 复核最终 diff 再跑测试。",
  "send_message 会在目标的最近一步边界插入消息，投递成功即持久，不必重发。",
  "共享任务的工作流是 list → get → 用当前 revision claim → 做事 → complete；任务就绪不会自动唤醒负责人。",
  "wait_agent 只观察调用之后的变更、不唤醒成员，没有其他成员能产生变更时立即返回 noProgress；",
  "唤醒或超时后重新 list。用 wait_agent 前先 list_agents 确认目标在跑，不在跑就先 send_message。",
  "Lead 必须等齐所需队友后才能给出最终答复。",
].join("\n");

/**
 * 投影里要替换成的文本；未列出的 section 原样保留。
 *
 * - 固定映射的两段（`@` 引用语义、输出链接规范）永远替换，文本不随会话变；
 * - `team:policy` 跟档位走：team 组启用给中文规则，未启用给空串（等于不注入那段规则）。
 */
export function replacementText(
  name: string,
  unlocked: readonly GroupKey[] | undefined,
): string | undefined {
  if (name === TEAM_POLICY_SECTION) {
    if (unlocked === undefined) return undefined;
    return unlocked.includes("team") ? TEAM_POLICY_TEXT : "";
  }
  return REPLACED_SECTION_TEXTS[name];
}

export const ENABLE_TOOLS_DESCRIPTION = [
  "启用尚未启用的能力组。",
  "工具目录已列出全部工具，但未启用的组会被拒绝执行；先看能力目录判断本任务需要哪些组，一次性全部传入。",
  "启用后从下一步开始可调用；已启用的组不会失效。",
].join("");

/** 档位的中文描述：命令回执与切换消息共用一份措辞。 */
export function renderLevel(groups: readonly GroupKey[]): string {
  const titles = [groupByKey(BASE_GROUP_KEY).title, ...groups.map((key) => groupByKey(key).title)];
  return `当前能力组：${titles.join(" + ")}。`;
}

/** 元工具的返回文本：本轮新启用、当前档位、以及下一步才可调用。 */
export function renderEnableResult(
  unlocked: readonly GroupKey[],
  added: readonly GroupKey[],
): string {
  const current = TOOL_GROUPS.filter(
    (group) => group.key === BASE_GROUP_KEY || unlocked.includes(group.key),
  ).map((group) => group.title);
  const lines: string[] = [];
  if (added.length === 0) {
    lines.push("没有新增能力组：传入的组要么已启用，要么不是已知组名。");
  } else {
    lines.push(`已启用：${added.map((key) => groupByKey(key).title).join("、")}。`);
  }
  lines.push(`当前可用：${current.join("、")}。`);
  lines.push("启用后从下一步开始可调用，不必重复调用。");
  return lines.join("");
}
