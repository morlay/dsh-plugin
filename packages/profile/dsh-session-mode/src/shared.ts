// host 半与 client 半共用的接口面：一条 HTTP 路径、模式行的对外形状、请求与响应体。
// 走 HTTP 路由而不是 Typert Remote：客户端的 remote 清单由上游硬编码，我们的服务不在里面。
// 会话当前模式不走这条通路：它是 session 投影（`sessionMode`），随会话列表一起到页面。

// 模式清单与切换的路由路径：宿主（web 与桌面）在同一张路由表上服务它。前缀是项目的统一约定
// （`/api/morlay/v1/<域>`，与 `ui-conversation-message-actions` 的 `/api/morlay/v1/session/*` 同一套），
// 不带前缀的裸路径会与 SPA 的静态资源 fallback 抢同一个命名空间。
import { groupByKey, groupOfTool, groupTitleOf } from "@morlay/dsh-tool-guidance/groups";

export const SESSION_MODE_PATH = "/api/morlay/v1/session-mode";

// 模式可以改写的上游 **policy 规则**名，即上游 waterfall 的事件名（是事件名、不是路径，所以**不带**前导斜杠）：
// `fs/write-intent`（写意图）与 `fs/edit-intent`（改意图）。home 在这里而不是 `modes.ts`：host 半的装配期校验
// 与 client 半的页面候选键都要它，而 client 半不 import `modes.ts`（免得把 schemastery 拖进浏览器包）。
// 「能拦什么」取决于上游是否在那条 waterfall 上独占决策槽——它不是配置能自己长出来的东西，所以这份名单是封闭的，
// 写进来的名字不在名单里就在装配期拒绝（见 `configProblem`）。
export const POLICY_NAMES = ["fs/write-intent", "fs/edit-intent", "fs/delete-intent"] as const;

// 一条 policy 规则的名字。
export type PolicyName = (typeof POLICY_NAMES)[number];

// 一个模式对外的那部分：选择器要的名字与说明。
export interface SessionModeRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

// `GET` 的响应体：清单与默认模式。
export interface SessionModeRoster {
  readonly default: string;
  readonly modes: readonly SessionModeRow[];
}

// `POST` 的请求体：把某个空白会话切到某个模式。
export interface SessionModeSelectRequest {
  readonly sessionId: string;
  readonly mode: string;
}

// `POST` 的响应体：切换后提交的模式 id。
export interface SessionModeSelectResult {
  readonly mode: string;
}

// `GET /session-mode?sessionId=<id>` 的响应体：某个会话**当下生效**的那一份（不是模式的配置清单）。
// 侧边栏面板读它——工具是运行期实际可见的那一份（按需组加载后随之变化），技能/政策是名单合成后的结果。
export type SessionModeSwitchKey = "instructions" | "skills" | "runtimeContext";

// 面板能编辑的字段（会话级覆盖与"另存为"都以它为准）。
export interface SessionModeEditable {
  readonly persona: { readonly prefix: string; readonly suffix: string };
  readonly allowTools: readonly string[];
  readonly denyTools: readonly string[];
  readonly allowSkills: readonly string[];
  readonly denySkills: readonly string[];
  readonly allowPolicies: readonly string[];
  readonly denyPolicies: readonly string[];
  readonly instructions: boolean;
  readonly skills: boolean;
  readonly runtimeContext: boolean;
}

// 全量目录：id + 描述（面板折叠组里逐条展示），`group` 用于工具的分组选择。
export type SessionModeTriState = "allow" | "deny";

export interface SessionModeDirectoryEntry {
  readonly id: string;
  readonly description: string;
  readonly group?: string;
  readonly groupLabel?: string;
  // 模式默认下的判定（继承来的那档）。
  // 模式配置里的显式档：`deny`（含组引用）、`allow`（白名单内）或 `default`（没显式配）。
  readonly fallback?: SessionModeTriState | "default";
  // 这个会话显式覆盖成的判定；`null`/缺省表示跟着默认。
  readonly override?: SessionModeTriState | null;
}

export interface SessionModeDirectory {
  readonly tools: readonly SessionModeDirectoryEntry[];
  readonly skills: readonly SessionModeDirectoryEntry[];
  readonly policies: readonly SessionModeDirectoryEntry[];
}

// 工具的组 id：MCP 一个 server 一组（`mcp:<server>`），其余是稳定的短 id。

// 不可被开关收窄的工具：`run_code` 是 PTC 的唯一入口，`describe_tool` 是它取签名的手段。
export const PROTECTED_TOOLS: ReadonlySet<string> = new Set(["run_code", "describe_tool"]);

export function isProtectedTool(name: string): boolean {
  return PROTECTED_TOOLS.has(name);
}

export function toolGroupOf(name: string): string {
  // 分组表的唯一 home 是 `@morlay/dsh-tool-guidance`（含 MCP 资源三件的 `mcp` 组）。
  const known = groupOfTool(name);
  if (known !== undefined) return known;
  // MCP server 的特殊性：一个 server 一组（`mcp:<server>`），工具名里动态带 server——静态表覆盖不了，放最后兜底。
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const separator = rest.indexOf("__");
    if (separator > 0) return `mcp:${rest.slice(0, separator)}`;
  }
  if (name.startsWith("tool_group_")) return "onDemand";
  return "other";
}

// 按需的组：正文不常驻注入，模型要用它们时走 `describe_tool({ group })` 现取。
// **它只回答"说明怎么送达"，不回答"工具能不能调"**：按需组与常驻组的工具在能力面上完全等价，
// 收窄只归模式的 `allowTools` / `denyTools`。
//
// 判据来自 guidance 的 `injection`（那份数据的 home 在 `packages/profile/dsh-tool-guidance`）：
// `mcp:<server>` 这类动态组在静态表里没有定义，一律按需；认不出的组名按常驻处理。
export function isOnDemandToolGroup(group: string): boolean {
  if (group === "onDemand" || group === "other") return false;
  if (group.startsWith("mcp:")) return true;
  try {
    return groupByKey(group).injection === "on-demand";
  } catch {
    return false;
  }
}

// 一条 section 名 → 它属于哪个工具组（认不出的返回 undefined）。
// 三类形状：`tool:<工具名>` 是单个工具的说明；`mcp:<server>` 是 MCP server 自己带的 instructions；
// `mcp-resource-servers` 是 MCP 资源三件的服务器清单。
export function sectionGroupOf(section: string): string | undefined {
  if (section.startsWith("mcp:")) return section;
  if (section.startsWith("tool:")) return toolGroupOf(section.slice("tool:".length));
  // 官方 `mcp-resources` 的清单 section 名字就是这个，没有前缀。
  if (section === "mcp-resource-servers") return "mcp";
  return undefined;
}

// 这条 section 是不是"按需组的说明"：是的话它只经 `describe_tool({ group })` 现取，不进系统提示。
// **它只回答"说明放在哪"，与工具能不能调无关**——按需组的工具在能力面上与常驻组完全等价。
export function isOnDemandSection(section: string): boolean {
  const group = sectionGroupOf(section);
  return group !== undefined && isOnDemandToolGroup(group);
}
export function toolGroupLabel(group: string): string {
  // MCP server 的特殊性：组 id 自带 server 名，显示成 `MCP · <server>`。
  if (group.startsWith("mcp:")) return `MCP · ${group.slice("mcp:".length)}`;
  return groupTitleOf(group) ?? (group === "onDemand" ? "按需工具" : "其它");
}

// 名单里引用整组时的写法：MCP 组直接用 `mcp:<server>`，其余加 `group:` 前缀。
export function groupRef(group: string): string {
  return group.startsWith("mcp:") ? group : `group:${group}`;
}

export function refGroup(ref: string): string {
  return ref.startsWith("group:") ? ref.slice("group:".length) : ref;
}

// 名单是否命中这个工具：写具体 id，或写它所属的组（`mcp:<server>` / `group:<id>`）。
export function deniedByList(deny: readonly string[], id: string): boolean {
  const group = toolGroupOf(id);
  return deny.some(
    (ref) =>
      ref === id ||
      ((ref.startsWith("group:") || ref.startsWith("mcp:")) && refGroup(ref) === group),
  );
}

// 两条 policy 的说明（面板与清单同源）。
export const POLICY_DESCRIPTIONS: Readonly<Record<PolicyName, string>> = {
  "fs/write-intent": "文件写入前的意图检查（CAS 安全网）。",
  "fs/edit-intent": "文件编辑前的意图检查（先读后改那条规则）。",
  "fs/delete-intent": "文件删除前的意图检查。",
};

export interface SessionModeActiveState {
  // 展示用的三件：模式 id / 名称 / 描述。
  readonly mode: { readonly id: string; readonly name: string; readonly description: string };
  // 与 TOML 同构的配置本身。
  readonly config: import("./mode-config.ts").ModeConfig;
  // 这个会话的覆盖（全量的一份配置；没有就是 undefined）。
  readonly session: import("./mode-config.ts").ModeConfig | undefined;
  // 覆盖里**真正与模式默认不同**的字段（面板按字段显示来源）。
  readonly overriddenFields?: readonly string[];
  // 全量目录（工具 / 技能 / policy）：id、描述、分组、配置值与覆盖值。
  readonly catalog: SessionModeDirectory;
  // 只有"另存为"出来的模式允许删除。
  readonly deletable: boolean;
}
