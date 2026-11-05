// host 半与 client 半共用的接口面：一条 HTTP 路径、模式行的对外形状、请求与响应体。
// 走 HTTP 路由而不是 Typert Remote：客户端的 remote 清单由上游硬编码，我们的服务不在里面。
// 会话当前模式不走这条通路：它是 session 投影（`sessionMode`），随会话列表一起到页面。

// 模式清单与切换的路由路径：宿主（web 与桌面）在同一张路由表上服务它。
export const SESSION_MODE_PATH = "/session-mode";

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

// 工具的组：MCP 一个 server 一组，其余归 core。
const TOOL_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["fs", ["read", "write", "edit", "apply_patch", "notebook", "glob", "grep", "working"]],
  ["shell", ["bash", "pwsh", "terminal", "job"]],
  ["web", ["web_search", "web_fetch"]],
  ["feedback", ["ask_user_question", "todo", "present"]],
  ["plan", ["plan", "exit_plan", "goal"]],
  [
    "collab",
    [
      "subagent",
      "send_message",
      "list_agents",
      "team",
      "spawn_teammate",
      "wait_agent",
      "interrupt_agent",
    ],
  ],
  ["schedule", ["schedule", "cron"]],
  ["skill", ["skill"]],
];

// 组的显示名（组 id 是配置里那个稳定值）。
const TOOL_GROUP_LABELS: Readonly<Record<string, string>> = {
  fs: "文件",
  shell: "Shell",
  web: "联网",
  collab: "协作",
  plan: "计划",
  schedule: "调度",
  feedback: "反馈",
  skill: "技能",
  workflow: "工作流",
  onDemand: "按需工具",
  other: "其它",
};

// 工具的组 id：MCP 一个 server 一组（`mcp:<server>`），其余是稳定的短 id。
export function toolGroupOf(name: string): string {
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const separator = rest.indexOf("__");
    if (separator > 0) return `mcp:${rest.slice(0, separator)}`;
  }
  // 工作流：`workflow` 本体与所有 `*_goal`（`get_goal` / `update_goal` …）。
  if (name === "workflow" || name.endsWith("_goal")) return "workflow";
  for (const [group, prefixes] of TOOL_GROUPS) {
    if (prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}_`))) return group;
  }
  if (name.startsWith("tool_group_")) return "onDemand";
  return "other";
}

// 常驻的组：这些组的工具默认就在目录里。其余组默认不进目录，由 `tool_group_list` / `tool_group_load`
// 按需放行——每个 MCP server 是一组，联网与工作流各自一组。
// `onDemand`（两个控制工具自己）与 `other`（认不出的工具）必须在常驻这一侧：前者否则没法放行任何组，
// 后者不该因为分组认不出就被藏起来。
const RESIDENT_TOOL_GROUPS: ReadonlySet<string> = new Set([
  "fs",
  "shell",
  "skill",
  "feedback",
  "plan",
  "collab",
  "schedule",
  "onDemand",
  "other",
  "other",
]);

// 这个组是不是常驻（不在按需面上）。
export function isResidentToolGroup(group: string): boolean {
  return RESIDENT_TOOL_GROUPS.has(group);
}

export function toolGroupLabel(group: string): string {
  return group.startsWith("mcp:")
    ? `MCP · ${group.slice("mcp:".length)}`
    : (TOOL_GROUP_LABELS[group] ?? "其它");
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
  readonly mode: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly persona: { readonly prefix: string; readonly suffix: string };
  };
  readonly tools: readonly string[];
  readonly skills: readonly string[];
  readonly policies: readonly string[];
  // 模式自己的原始值：面板据此把"会话覆盖"与"继承默认"分开显示。
  readonly defaults: SessionModeEditable;
  // 合并后的名单：三态开关基于它增删。
  readonly effective: SessionModeEditable;
  // 这个会话**生效**的值（模式默认 + 会话级覆盖）。
  readonly switches: Readonly<Record<SessionModeSwitchKey, boolean>>;
  // 模式的原始值：面板据此把"会话覆盖"与"继承默认"分开显示。
  readonly switchDefaults: Readonly<Record<SessionModeSwitchKey, boolean>>;
  // 哪几项被这个会话覆盖了（`null` 表示回到模式默认）。
  readonly overriddenSwitches: readonly SessionModeSwitchKey[];
  // 被会话覆盖的字段名（`SessionModeEditable` 的键）。
  readonly overriddenFields: readonly string[];
  // 这个模式是不是"另存为"出来的（只有它们允许删除）。
  readonly deletable: boolean;
  // 全量目录（工具 / 技能 / policy）的 id 与描述，供面板逐条展示。
  readonly catalog: SessionModeDirectory;
}
