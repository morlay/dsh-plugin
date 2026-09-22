import { jsExpr } from "./js-expr.ts";

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

/** context 组那个包：能力走子出口，所以包名前缀在这里、能力名在各行（见 {@link context}）。 */
const CONTEXT_PACKAGE = "@morlay/dsh-context";

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

/**
 * context 组那一行：包的主出口是**组装插件**——按 config 决定装哪些能力、各带什么参数，所以装配面
 * 只有这一行，组成与各能力的 config 都归包内（`capabilities` 缺省即完整的一套；`chat` 用它裁剪）。
 */
export function contextChannel(config?: Readonly<Record<string, unknown>>): PresetRow {
  return { id: "context", name: CONTEXT_PACKAGE, ...(config === undefined ? {} : { config }) };
}

/** 通道组的 id：`isolate` 的 label 按服务名给，与组 id 无关。 */
export const CHANNEL_GROUP_ID = "context-channel";

/**
 * 关住 context 那一行：`isolate` 生成的隔离 realm 只对组内 ctx 生效——通道服务因此留在 preset 的
 * realm 里，别的 preset 拿不到它。组外放任何一行 context，它的 `inject` 都等不到服务（行停在 waiting，
 * 不报错），所以这一组里只该有组装行。
 */
export function channelGroup(rows: readonly PresetRow[]): PresetRow {
  return group(CHANNEL_GROUP_ID, rows, { isolate: { contextAssembler: true } });
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
