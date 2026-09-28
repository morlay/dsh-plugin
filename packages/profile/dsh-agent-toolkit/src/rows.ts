import { toolNamesOf } from "./guidance/packs/index.ts";
import { jsExpr, type JsExpr } from "./js-expr.ts";

/**
 * 行工具与**功能行清单**的真源。
 *
 * 本包是 bundle（`cordis.patch.yml` 可直接装配），也是 preset 引用功能行的那一份清单：
 * preset 只留提示词与能力开关，工具 / 命令 / 委派 / 压缩这批行从这里引用——两种采用方式同源。
 *
 * 功能行按**工具族**分组（一个族一个 `cordis:group`，组 id 就是族名），与提示词侧的汉化数据
 * （[`guidance/packs/`](./guidance/packs)）同构：族回答"这些工具怎么讲"，也是"这些行属于哪一族"。
 * 分组不设门控——所有行照装，它表达的是归类，不是开关。
 */

/** 产物里的一行；`config` 既可以是行配置，也可以是 `cordis:group` 的子行数组。 */
export interface PresetRow {
  readonly id: string;
  readonly name: string;
  readonly group?: boolean;
  readonly isolate?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean | { readonly __jsExpr: string };
  readonly config?: Readonly<Record<string, unknown>> | readonly PresetRow[];
}

/** 行定义里可以省掉 id（默认取短名），也可以带组 / isolate / config。 */
export interface RowExtra {
  readonly id?: string;
  readonly group?: boolean;
  readonly isolate?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean | { readonly __jsExpr: string };
  readonly config?: Readonly<Record<string, unknown>> | readonly PresetRow[];
}

const UPSTREAM_SCOPE = "@deepseek-ai/dsh-";

/** 行 id 默认取短名（可被 extra.id 覆盖）。 */
function named(short: string, name: string, extra: RowExtra): PresetRow {
  const { id, ...rest } = extra;
  return { id: id ?? short, name, ...rest };
}

/**
 * 上游的一行：`row("tool-fs")` → 包 `@deepseek-ai/dsh-tool-fs`、行 id `tool-fs`。
 *
 * 包名按「scope + 短名」拼（目录名不可靠：`packages/compaction/tool-result-pruner` 的包名是
 * `@deepseek-ai/dsh-compaction-tool-result-pruner`）；id 由我们自己定，默认与短名一致。
 * 带 subpath 的行（`tool-subagent-control/list-agents`）与需要短 id 的行显式给 `id`。
 */
export function row(short: string, extra: RowExtra = {}): PresetRow {
  return named(short, `${UPSTREAM_SCOPE}${short}`, extra);
}

/** 一个工具族：`group("toolkit-"+族名, 行)`——组名与 `guidance/packs/` 的族文件同名（前缀见 {@link TOOLKIT_ROWS}）。 */
export function group(
  id: string,
  config: readonly PresetRow[],
  extra: Omit<RowExtra, "id" | "config"> = {},
): PresetRow {
  return { id, name: "cordis:group", group: true, config, ...extra };
}

/**
 * 这套工具集的工具名（从汉化数据派生：**工具集与汉化同源**）。
 *
 * 谁需要它：模式的 `allowTools` 白名单——模式只声明"我要哪些"，工具行本身在 profile 平面装一次。
 */
export const TOOLKIT_TOOL_NAMES: readonly string[] = toolNamesOf();

/**
 * Agent Teams 的开关：`DSH_AGENT_TEAM=1` 时启用（装配期求值，见 {@link TEAM_ROWS}）。
 * 团队装上来时它与直接派发（`subagent` / `subagent_fork` / 控制行）互斥，上游 `agent-team-profile`
 * 的做法也是把直接派发那几行禁掉。
 */
export const AGENT_TEAM_ENV = "DSH_AGENT_TEAM";

/** 团队开启时，直接派发那几行让位（`!!js`，装配期求值）。 */
export function directDelegationDisabled(): JsExpr {
  return jsExpr(() => process.env.DSH_AGENT_TEAM === "1");
}

/** agent-team 那几行默认关闭：不是 `DSH_AGENT_TEAM=1` 就不装。 */
export function agentTeamDisabled(): JsExpr {
  return jsExpr(() => process.env.DSH_AGENT_TEAM !== "1");
}

/** 跨平台的一对 shell 工具：装哪一半由运行期平台决定。 */
export const SHELL_ROWS: readonly PresetRow[] = [
  row("tool-bash", { disabled: jsExpr(() => process.platform === "win32") }),
  row("tool-pwsh", { disabled: jsExpr(() => process.platform !== "win32") }),
];

/**
 * Agent Teams 那一族（上游实验能力：roster / 消息 / 共享任务 + 模型侧工具 + Web UI），默认关闭。
 *
 * 关闭写在**行**上：Loader 对 `group: true` 的条目恒为启用，组级 `disabled` 不生效，整组会照装。
 */
export const TEAM_ROWS: readonly PresetRow[] = [
  row("experimental-agent-team", {
    id: "agent-team",
    disabled: agentTeamDisabled(),
    config: {
      maxMembers: 8,
      maxTasks: 256,
      maxPendingMessagesPerMember: 64,
      maxMessageBytes: 65_536,
      disposalTimeoutMs: 5_000,
    },
  }),
  row("experimental-tool-agent-team", {
    id: "tool-agent-team",
    disabled: agentTeamDisabled(),
    config: { freshProvider: "spawn", forkProvider: "fork" },
  }),
  row("experimental-client-ui-agent-team", {
    id: "ui-agent-team",
    disabled: agentTeamDisabled(),
  }),
];

/**
 * 完整一套功能行（coding 用），**按工具族分组**：族顺序与 `guidance/packs/index.ts` 的族索引一致。
 * 它们引用的都是上游包，行 id 由本仓库定（见 {@link row}）。
 *
 * 组 id 是 `toolkit-<族名>`（不是裸族名）：装配按 id 全局对应，上游已有行占用 `web` / `skill` 这类短名，
 * 撞上会让两行被当作同一行（后者覆盖前者的 config，组行拿到非数组 config 直接装配失败）。
 */
export const TOOLKIT_ROWS: readonly PresetRow[] = [
  group("toolkit-ask", [row("tool-ask-user")]),
  group(
    "toolkit-delegation",
    [
      // 团队开启时（DSH_AGENT_TEAM=1）直接派发让位给 Agent Teams：上游 agent-team-profile 同款换法。
      row("tool-subagent-control", { disabled: directDelegationDisabled() }),
      row("tool-subagent-control/list-agents", {
        id: "tool-subagent-list-agents",
        disabled: directDelegationDisabled(),
      }),
      // 不带 `modelSelectionSettings`：子代理一律继承父会话的模型（见 dsh-preset 的 patch 说明）。
      row("tool-subagent", {
        config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" },
        disabled: directDelegationDisabled(),
      }),
      // 同一个包的第二个实例：换 provider 就是 fork 那一支。
      row("tool-subagent", {
        id: "tool-subagent-fork",
        config: { provider: "fork", toolName: "subagent_fork", backgroundMode: "continuable" },
        disabled: directDelegationDisabled(),
      }),
      row("workflow-ptc", { config: { provider: "spawn" } }),
      row("tool-workflow"),
    ],
    { isolate: { workflowEngine: true } },
  ),
  group("toolkit-flow", [
    row("tool-todo", { config: { allowParallelInProgress: true } }),
    row("command-goal"),
    row("tool-goal"),
    row("tool-present", { id: "present" }),
  ]),
  group("toolkit-fs", [
    row("tool-fs"),
    row("tool-fs-search", { config: { sampleOverCapGlobResults: false } }),
  ]),
  group("toolkit-shell", [...SHELL_ROWS, row("tool-jobs")]),
  // skill 发现：目录与 `skill` 工具由 context-skill-catalog 接管，但 provider 仍是它。
  group("toolkit-skill", [row("skill-filesystem")]),
  group("toolkit-team", TEAM_ROWS),
  group("toolkit-web", [row("tool-web", { config: { fetch: true, searchTimeoutMs: 60000 } })]),
];

/**
 * 不属于任何工具族、但归 preset 平面的行：上下文压缩（引擎，不是模型侧工具）与计划模式。
 */
export const TOOLKIT_COMPACTION_ROWS: readonly PresetRow[] = [
  group(
    "compaction",
    [
      row("compaction-basic"),
      row("command-compact"),
      row("compaction-tool-result-pruner", {
        id: "tool-result-pruner",
        config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
      }),
    ],
    { isolate: { compaction: true, toolResultPruner: true } },
  ),
];

/**
 * 计划模式的规则段（`plan:policy`，只在计划模式激活时进提示词）：中文，与 persona、工具说明同一语言。
 *
 * 六件事与上游那份一一对应，一条不多：何时进入与何时退出、只读探索、这些规则压过工具说明、自己能查的事实
 * 自己查、计划要决策完备、以及 `exit_plan_mode` 的提交与驳回。改它请同时核对
 * `vendor/deepseek-harness/packages/plan/plan-mode/src/index.ts` 的 `exit_plan_mode` 契约（工具描述、
 * `plan-review` 的批准语义）。
 */
export const PLAN_MODE_SECTION = [
  "你处于计划模式。在 exit_plan_mode 成功、或用户切换会话模式之前，一直留在计划模式。",
  "",
  "先探索：用非破坏性的读、搜索、静态分析与检查，把计划落到真实仓库上。不要做任何写操作——不改文件、不改配置、不跑会重写被跟踪文件的格式化或代码生成、不提交，也不要把计划执行掉。优先用仓库里已有的函数与写法，不要新造机制。",
  "",
  "用户的对话式同意（包括对你自己提问的肯定回答）不构成批准，也不结束计划模式；把确认到的决定并进计划里。",
  "",
  "工具目录在模式之间保持一致（请求缓存稳定），所以这些规则压过任何后续工具说明或用法正文里“去改文件”的建议；那些工具仍列在目录里，只是这一步不能用。不要用 todo_write 跟踪规划阶段：它跟的是批准之后的实施，计划本身归 exit_plan_mode。",
  "",
  "能自己查清的事实自己查。只有用户拥有的选择、或检查无法回答的实质歧义才用 ask_user_question；不要问代码在哪、现在怎么跑这类自己能查明的问题。",
  "",
  "计划要决策完备：目标与成功判据；按子系统分组的改动；公共 API、schema 与数据流的变化；边界情况与失败模式；测试与验收判据；显式假设。可审即可，不必长到别人照它实现还要自己做设计决定。",
  "",
  "就绪时调 exit_plan_mode，正文是完整的计划 markdown（以 # 标题开头），并让它成为那一条回复里唯一且最后的工具调用：它把计划交出去等批准，实施只在批准之后的步骤里开始。不要把最终计划当普通回复贴出来，也不要用散文或 ask_user_question 问“要不要继续”。评审驳回就吸收反馈重新提交；评审通道不可用或被中断时留在计划模式、让用户手动切模式，不要自己往下做。",
].join("\n");

/**
 * 计划模式（`plan-mode` 行 + 它的 `exit_plan_mode` 工具）：组形照上游
 * （`bundle/web-app/presets/standard.patch.yml` 的 `planning` 组：`isolate: { planMode: true }`——preset realm
 * 里的服务必须隔离，否则 mount 直接失败）。
 *
 * **规则正文由我们自己维护**（{@link PLAN_MODE_SECTION}，中文）：`@deepseek-ai/dsh-plan-mode` 的 `section` 是
 * 部署自有的必填项（`vendor/deepseek-harness/packages/plan/plan-mode/src/index.ts` 的 `resolveConfig`：缺 / 空 /
 * 多键都抛），**没有默认文案**，所以这一行必须带上它。代价是上游改 `plan-mode` 的契约（`section` 的形状、
 * `exit_plan_mode` 的行为）时要人工核对这段中文的语义。
 */
export const TOOLKIT_PLAN_ROWS: readonly PresetRow[] = [
  group("planning", [row("plan-mode", { config: { section: PLAN_MODE_SECTION } })], {
    isolate: { planMode: true },
  }),
];

/**
 * 不属于任何工具族的行：上下文压缩与计划模式（preset 平面）、工具说明那一行（host 平面）。
 *
 * 说明行 `inject` 注入通道（`contextAssembler`）——通道在 profile 平面装一次且不做隔离，所以它作为
 * 普通行装在同一个平面就能解析到。`config.groups: false` 表示只要工具投影预处理、不注册用法分组。
 */
export const TOOLKIT_EXTRA_ROWS: readonly PresetRow[] = [
  ...TOOLKIT_COMPACTION_ROWS,
  toolGuidanceRow(),
];

/**
 * preset 平面那一套功能行：**preset 声明的 `config.plugins` 就是它**。
 *
 * 与 {@link TOOLKIT_EXTRA_ROWS} 的差别只在 `tool-guidance` 那一行：它往通道这个 host 单例注册用法正文
 * （skill 与 section 抑制），属于 host 平面——两个平面各装一份会互相顶掉（上游判据：一行只属于一个平面，
 * `vendor/deepseek-harness/scripts/verify-cordis-config.ts` 的 `validatePresetPlaneSeparation`）。
 * 其余行都是**每会话的能力行**：工具、命令、压缩、计划模式与 skill 发现 provider。
 */
export const TOOLKIT_PRESET_ROWS: readonly PresetRow[] = [
  ...TOOLKIT_ROWS,
  ...TOOLKIT_COMPACTION_ROWS,
  ...TOOLKIT_PLAN_ROWS,
];

/** 工具说明那一行（汉化精简 + 用法分组）：实现与数据在 `./guidance` 出口，行本身也归本包。 */
export function toolGuidanceRow(config?: Readonly<Record<string, unknown>>): {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
} {
  return {
    id: "tool-guidance",
    name: "@morlay/dsh-agent-toolkit/guidance",
    ...(config === undefined ? {} : { config }),
  };
}

/** 对话模式要的那两件：问答与联网。 */
export const CHAT_TOOLKIT_ROWS: readonly PresetRow[] = [row("tool-ask-user"), row("tool-web")];
