import { jsExpr } from "./js-expr.ts";

/**
 * 行工具与**功能行清单**的真源。
 *
 * 本包是 bundle（`cordis.patch.yml` 可直接装配），也是 preset 引用功能行的那一份清单：
 * preset 只留提示词与能力开关，工具 / 命令 / 委派 / 压缩这批行从这里引用——两种采用方式同源。
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

/** `cordis:group` 行：id 必须显式给（包名位置是组标记，推不出短名）。 */
export function group(
  id: string,
  config: readonly PresetRow[],
  extra: Omit<RowExtra, "id" | "config"> = {},
): PresetRow {
  return { id, name: "cordis:group", group: true, config, ...extra };
}

/** 跨平台的一对 shell 工具：装哪一半由运行期平台决定。 */
export const SHELL_ROWS: readonly PresetRow[] = [
  row("tool-bash", { disabled: jsExpr(() => process.platform === "win32") }),
  row("tool-pwsh", { disabled: jsExpr(() => process.platform !== "win32") }),
];

/**
 * 完整一套功能行（coding 用）：shell、文件、任务、skill 发现、goal、压缩、委派与工作流、问答、
 * todo、联网、交付物。它们引用的都是上游包，行 id 由本仓库定（见 row()）。
 */
export const TOOLKIT_ROWS: readonly PresetRow[] = [
  // persona 按模式给：注册 agent 作用域的同名 section，遮蔽部署级那层。
  ...SHELL_ROWS,
  row("tool-fs"),
  row("tool-fs-search", { config: { sampleOverCapGlobResults: false } }),
  row("tool-jobs"),
  // skill 发现：目录与 `skill` 工具由 context-skill-catalog 接管，但 provider 仍是它。
  row("skill-filesystem"),
  row("command-goal"),
  row("tool-goal"),
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
  group(
    "delegation",
    [
      row("tool-subagent-control"),
      row("tool-subagent-control/list-agents", { id: "tool-subagent-list-agents" }),
      // 不带 `modelSelectionSettings`：子代理一律继承父会话的模型（见 dsh-preset 的 patch 说明）。
      row("tool-subagent", {
        config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" },
      }),
      // 同一个包的第二个实例：换 provider 就是 fork 那一支。
      row("tool-subagent", {
        id: "tool-subagent-fork",
        config: { provider: "fork", toolName: "subagent_fork", backgroundMode: "continuable" },
      }),
      row("workflow-ptc", { config: { provider: "spawn" } }),
      row("tool-workflow"),
    ],
    { isolate: { workflowEngine: true } },
  ),
  row("tool-ask-user"),
  row("tool-todo", { config: { allowParallelInProgress: true } }),
  row("tool-web", { config: { fetch: true, searchTimeoutMs: 60000 } }),
  row("tool-present", { id: "present" }),
];

/** 对话模式要的那两件：问答与联网。 */
export const CHAT_TOOLKIT_ROWS: readonly PresetRow[] = [
  row("tool-ask-user"),
  row("tool-web"),
];
