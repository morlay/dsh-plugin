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
 * context 组的一行：**包名与行 id 都由「前缀 + 能力名」派生**——
 * `context("assembler")` → 包 `@morlay/dsh-context/assembler`、行 id `context-assembler`。
 *
 * 这一组（通道与它的注入方）合成一个包、各占一个子出口，所以装配面上只有"前缀 + 能力名"一个说法：
 * 加一个能力就是加一个子出口 + 这里一行，不必再造包名与 id 的拼法。
 */
export function context(capability: string, extra: RowExtra = {}): PresetRow {
  return named(`context-${capability}`, `${CONTEXT_PACKAGE}/${capability}`, extra);
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
 * 注入通道：发布服务 `ctx.contextAssembler`，所以它自己也在组里（组声明 `isolate`）。
 *
 * 通道曾经住 host 层（「部署级一份、一行覆盖全部 preset」），代价是它的注册表不分 scope——我们的注入
 * 于是漏进了官方 standard / ptc / cordis 的会话。改成每个模式自带一份、关在 `isolate` 组里以后，
 * 通道与它的消费者只在这棵子树可见：上游 `leakedServices` 不再把它算作全局泄漏，别的 preset 也拿不到它。
 */
export const ASSEMBLER_ROW: PresetRow = context("assembler");

/** 通道组的 id：`isolate` 的 label 按服务名给，与组 id 无关。 */
export const CHANNEL_GROUP_ID = "context-channel";

/**
 * 通道与它的消费者**必须同子树**：`isolate` 生成的隔离 realm 只对组内 ctx 生效，组外的行解析
 * `ctx.contextAssembler` 会拿到 root realm 的实现（不存在，或别人的）。
 */
export function channelGroup(rows: readonly PresetRow[]): PresetRow {
  return group(CHANNEL_GROUP_ID, rows, { isolate: { contextAssembler: true } });
}

/** 注入相关的行：**按模式给**，且都住在通道组里（见 {@link channelGroup}）。 */
export const INJECTION_ROWS: readonly PresetRow[] = [
  context("agent-instructions"),
  context("skill-catalog"),
  context("reference"),
];

/** 工具用法分组：组表在包里，这里只是把它挂上。 */
export const TOOL_GUIDANCE_ROW: PresetRow = context("tool-guidance");
