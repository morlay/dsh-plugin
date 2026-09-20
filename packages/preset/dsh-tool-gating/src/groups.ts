/**
 * 工具分档表与档位算法。
 *
 * 唯一的 home：组名、中文描述、成员工具、**每组一份的使用提示**、工具的短描述，
 * 以及被忽略的上游工具说明 section 清单；插件装配与覆盖性测试都读这一份。
 *
 * 档位不再裁剪工具目录：tools schema 恒定（缓存稳定），档位决定「追加哪一段使用提示」
 * 与「哪些工具允许调用」（执行层拒绝）。见 README 的前缀缓存一节。
 */

export const GROUP_KEYS = ["base", "flow", "web", "team"] as const;

export type GroupKey = (typeof GROUP_KEYS)[number];

export const BASE_GROUP_KEY: GroupKey = "base";

export const ENABLE_TOOLS_NAME = "enable_tools";

export interface ToolGroup {
  readonly key: GroupKey;
  readonly title: string;
  readonly summary: string;
  /** 该组的基础用法提示（不依赖具体工具）。 */
  readonly guidance: string;
  /**
   * 仅在指定工具存在时追加的句子：`[工具名, 句子]`。
   *
   * 一个组可以容纳**多套等价工具**——Agent Teams 的官方 bundle 开关会替换掉委派工具
   * （`subagent*` ↔ `spawn_teammate` / `team_task_*`），所以提示按实际装配拼。
   */
  readonly guidanceByTool?: readonly (readonly [string, string])[];
  /** 组内所有可能的工具名（并集）；渲染时按实际装配过滤。 */
  readonly tools: readonly string[];
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    key: "base",
    title: "基础",
    summary: "读写文件、搜索内容、执行命令、抓取网页、读取图片与技能、收集后台任务、会话提问",
    guidance:
      "读文件用 read（大文件配 offset/limit），改动用 edit（精确替换）或 write（整文件覆盖），" +
      "找文件用 glob、找内容用 grep；命令用 bash，非零退出会以 [exit code: N] 标记，长任务用 " +
      "run_in_background 启动，再用 job_output/job_list/job_kill 收集或终止；网页用 web_fetch 抓取，" +
      "图片用 read_image，技能用 skill 按需加载；需要用户定夺时用 ask_user_question。",
    tools: [
      "read",
      "write",
      "edit",
      "glob",
      "grep",
      "bash",
      "pwsh",
      "ask_user_question",
      "job_output",
      "job_list",
      "job_kill",
      "read_image",
      "web_fetch",
      "skill",
    ],
  },
  {
    key: "flow",
    title: "流程",
    summary: "多步任务的待办清单与计划模式、会话目标、交付物声明",
    guidance:
      "多步任务先用 todo_write 建清单并逐步更新；动手前用 exit_plan_mode 提交计划（计划模式下只读，" +
      "按 plan 规则约束）；长任务用 create_goal/get_goal/update_goal 跟踪目标进展；" +
      "要给用户看的产物用 present 声明。",
    tools: ["todo_write", "exit_plan_mode", "get_goal", "create_goal", "update_goal", "present"],
  },
  {
    key: "web",
    title: "联网检索",
    summary: "联网搜索",
    guidance: "web_search 联网检索；结果不足时用基础组的 web_fetch 抓取具体页面。",
    tools: ["web_search"],
  },
  {
    key: "team",
    title: "协作编排",
    summary: "派发子代理或队友、编排多代理工作流、与队友协同",
    guidance: "派发时把约束写进任务说明（工作目录、要遵守的 AGENTS.md、验收标准）。",
    // 两套委派工具互斥地出现在不同装配形态下（官方 Agent Teams bundle 会用后一套替换前一套）。
    guidanceByTool: [
      [
        "subagent",
        "派发子代理用 subagent（默认后台，独立任务一次起多路）；需要继承当前上下文时用 subagent_fork；" +
          "list_subagent_models 查可用模型。",
      ],
      ["spawn_teammate", "派发队友用 spawn_teammate（可指定后台与模型）。"],
      [
        "workflow",
        "跨多代理的大规模编排用 workflow（写一段 JavaScript 脚本），仅当用户明确要求时使用；" +
          "一两处委派直接用上面的派发工具。",
      ],
      [
        "send_message",
        "与队友协作：list_agents 看有谁、send_message 发消息、wait_agent 等回复、interrupt_agent 打断、" +
          "team_task_create/team_task_list/team_task_get/team_task_update 走共享任务板。",
      ],
    ],
    tools: [
      "subagent",
      "subagent_fork",
      "list_subagent_models",
      "spawn_teammate",
      "send_message",
      "list_agents",
      "wait_agent",
      "interrupt_agent",
      "team_task_create",
      "team_task_list",
      "team_task_get",
      "team_task_update",
      "workflow",
    ],
  },
];

/**
 * 覆盖上游 `description` 的中文短描述。
 *
 * 工具 schema 全量常驻，所以描述只讲「这个工具做什么」；参数细节留在 schema 里、用法留在按组提示里。
 * 上游改了参数不需要动这里；上游改了工具职责才需要跟（覆盖性测试会提醒工具集有变动）。
 */
export const SHORT_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  read: "读文件内容（可指定行范围）",
  write: "写入文件或整文件覆盖",
  edit: "按精确匹配替换文件片段",
  glob: "按模式查找文件路径",
  grep: "按正则搜索文件内容",
  bash: "执行 shell 命令",
  pwsh: "执行 PowerShell 命令",
  ask_user_question: "向用户提问并等待回答",
  job_output: "读取后台任务的输出",
  job_list: "列出后台任务",
  job_kill: "终止后台任务",
  read_image: "读取图片内容",
  web_fetch: "抓取指定 URL 的内容",
  skill: "按需加载技能说明",
  subagent: "派发子代理执行任务",
  subagent_fork: "派发继承当前上下文的子代理",
  list_subagent_models: "查看子代理可用的模型",
  workflow: "用脚本编排多个子代理",
  todo_write: "维护多步任务的待办清单",
  exit_plan_mode: "提交计划并请求批准",
  get_goal: "查看当前会话目标",
  create_goal: "创建会话目标",
  update_goal: "更新会话目标状态",
  present: "声明交付给用户的产物",
  web_search: "联网搜索",
  spawn_teammate: "招募一个队友",
  send_message: "给队友发消息",
  list_agents: "列出可协作的代理",
  wait_agent: "等待队友回复",
  interrupt_agent: "打断某个队友",
  team_task_create: "创建共享任务",
  team_task_list: "列出共享任务",
  team_task_get: "读取共享任务",
  team_task_update: "更新共享任务状态",
};

/**
 * 被忽略的上游工具说明 section：本部署改成按组给一份使用提示，
 * 因此逐个工具的说明不再进提示词。清单是静态的（不随档位变化）。
 *
 * 只列**注册在 preset 作用域**（比 agent 更远的层）的说明——遮蔽靠 agent 作用域的同名
 * section 生效，同层重复注册会抛错。`tool-subagent` 的说明用 `tool:${toolName}` 模板注册：
 * 它在本部署注册在 preset 层（生成器删掉了 `modelSelectionSettings`），因此可以遮蔽；
 * 一旦那个配置回到产物里，它会改注册到 agent 层，遮蔽就会失败——产物测试与
 * 「忽略清单不与 agent 作用域注册重叠」的断言一起把这条前提锁住。
 */
export const IGNORED_SECTIONS: readonly string[] = [
  "tool:read",
  "tool:write",
  "tool:edit",
  "tool:glob",
  "tool:grep",
  "tool:bash",
  "tool:pwsh",
  "tool:jobs",
  "tool:web_fetch",
  "tool:web_search",
  "tool:goal",
  "tool:subagent",
  "tool:subagent_fork",
  "tool:workflow",
  "tool:lsp",
  "tool:pty",
  "tool:session-query",
  "tool:cordis",
  "tool:ralph",
  // `team:policy` 不在这里：`tool-agent-team` 用 `agent.ctx` 注册它（agent 作用域），
  // 同层遮蔽会抛 "already registered in this scope"。它按团队能力自渲染，留着即可。
  // host / app 层的平台说明：讲的是 dev server / HMR / 本地 checkout 位置这类运维约定，
  // 与本部署的模型任务无关（两条都注册在 host 层，遮蔽不会撞同层重名）。
  "app:web-surface",
  "harness:source",
];

export function isGroupKey(value: string): value is GroupKey {
  return (GROUP_KEYS as readonly string[]).includes(value);
}

export function groupByKey(key: GroupKey): ToolGroup {
  const group = TOOL_GROUPS.find((entry) => entry.key === key);
  if (group === undefined) throw new Error(`tool-gating: unknown group "${key}"`);
  return group;
}

/** 归一化模型给出的组名：只收已知组，去重保序；基础组不算「启用」。 */
export function normalizeGroups(raw: readonly string[]): GroupKey[] {
  const groups: GroupKey[] = [];
  for (const value of raw) {
    if (!isGroupKey(value) || value === BASE_GROUP_KEY || groups.includes(value)) continue;
    groups.push(value);
  }
  return groups;
}

/** 工具名 → 它所属的组；没有归组的工具（含 `enable_tools`）返回 undefined。 */
export function groupOfTool(toolName: string): ToolGroup | undefined {
  return TOOL_GROUPS.find((group) => group.tools.includes(toolName));
}

/** 当前档位下的按组使用提示：基础组常驻，其余随启用与否。 */
export function guidanceOf(
  unlocked: readonly GroupKey[],
  exists: (name: string) => boolean,
): string[] {
  return [BASE_GROUP_KEY, ...unlocked].map((key) => {
    const group = groupByKey(key);
    const extra = (group.guidanceByTool ?? [])
      .filter(([toolName]) => exists(toolName))
      .map(([, sentence]) => sentence);
    return `【${group.title}】${[group.guidance, ...extra].join("")}`;
  });
}

/** 本部署实际装了工具的组：能力目录据此跳过空组（例如未装 Agent Teams 时的形态差异）。 */
export function presentGroups(exists: (name: string) => boolean): ToolGroup[] {
  return TOOL_GROUPS.filter((group) => group.tools.some(exists));
}

/**
 * 执行层的档位判定：返回拒绝原因，或 `undefined` 表示放行。
 *
 * 未归组的工具一律放行——它们不是档位管理的对象（`enable_tools`、host plane 的机制工具、
 * 上游新增但还没归组的工具），拒绝它们只会造成静默失效。归组但未启用的工具则拒绝，
 * 并把解锁路径告诉模型。
 */
export function deniedToolReason(
  unlocked: readonly GroupKey[],
  toolName: string,
): string | undefined {
  const group = groupOfTool(toolName);
  if (group === undefined || group.key === BASE_GROUP_KEY || unlocked.includes(group.key)) {
    return undefined;
  }
  return (
    `${toolName} 属于尚未启用的「${group.title}」组，现在不能调用。` +
    `先把本任务需要的能力一次性交给 ${ENABLE_TOOLS_NAME}（用户也可以用 /tools ${group.key} 直接切换），` +
    "启用后从下一步开始可用。"
  );
}

/** 当前档位下允许调用的工具名（供测试与提示使用）。 */
export function allowedToolNames(unlocked: readonly GroupKey[]): string[] {
  const allowed = [BASE_GROUP_KEY, ...unlocked];
  return TOOL_GROUPS.filter((group) => allowed.includes(group.key)).flatMap((group) => group.tools);
}
