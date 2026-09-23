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
 * 不属于任何工具族的行：上下文压缩（引擎，不是模型侧工具）与工具说明那一行。
 *
 * 说明行 `inject` 注入通道（`contextAssembler`）——通道在 profile 平面装一次且不做隔离，所以它作为
 * 普通行装在同一个平面就能解析到。`config.groups: false` 表示只要工具投影预处理、不注册用法分组。
 */
export const TOOLKIT_EXTRA_ROWS: readonly PresetRow[] = [
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
  toolGuidanceRow(),
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
