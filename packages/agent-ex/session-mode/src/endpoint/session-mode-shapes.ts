// `sessionMode` 这一组的两端共用形状：清单、生效态、全量目录与写面补丁。
import type { ModeConfig } from "./mode-config.ts";

// 模式可以改写的上游 policy 规则名（上游 waterfall 的事件名，不带前导斜杠）。名单封闭：写错的名字在装配期
// 就拒绝，而不是静默变成"没配"。
export const POLICY_NAMES = ["fs/write-intent", "fs/edit-intent", "fs/delete-intent"] as const;

export type PolicyName = (typeof POLICY_NAMES)[number];

// 三条 policy 的说明（面板与清单同源）。
export const POLICY_DESCRIPTIONS: Readonly<Record<PolicyName, string>> = {
  "fs/write-intent": "文件写入前的意图检查（CAS 安全网）。",
  "fs/edit-intent": "文件编辑前的意图检查（先读后改那条规则）。",
  "fs/delete-intent": "文件删除前的意图检查。",
};

// 一个模式对外的那部分：选择器要的名字与说明。
export interface SessionModeRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface SessionModeRoster {
  readonly default: string;
  readonly modes: readonly SessionModeRow[];
}

export type SessionModeSwitchKey = "instructions" | "skills" | "runtimeContext";

export type SessionModeTriState = "allow" | "deny";

export interface SessionModeDirectoryEntry {
  readonly id: string;
  readonly description: string;
  readonly group?: string;
  readonly groupLabel?: string;
  // 模式默认下的判定（继承来的那档）。
  readonly fallback?: SessionModeTriState | "default";
  // 这个会话显式覆盖成的判定；`null` 表示跟着默认。
  readonly override?: SessionModeTriState | null;
}

export interface SessionModeDirectory {
  readonly tools: readonly SessionModeDirectoryEntry[];
  readonly skills: readonly SessionModeDirectoryEntry[];
  readonly policies: readonly SessionModeDirectoryEntry[];
}

// 某个会话**当下生效**的一份（工具是运行期实际可见的集合）。
export interface SessionModeActiveState {
  readonly mode: { readonly id: string; readonly name: string; readonly description: string };
  readonly config: ModeConfig;
  readonly session: ModeConfig | undefined;
  readonly overriddenFields: readonly string[];
  readonly catalog: SessionModeDirectory;
  // 还能不能换模式（空白窗口）：面板据此把选择器画成只读。
  readonly editable: boolean;
  // 只有"另存为"出来的模式允许删除。
  readonly deletable: boolean;
}

// 面板的写面：`null` = 清掉这一项的会话覆盖、回到模式默认。
export type SessionModePatch = Readonly<Record<string, unknown>>;

// 全局候选（工具名 / 技能名）：配置页与面板的名单字段用。
export interface SessionModeCatalogValue {
  readonly tools: readonly string[];
  readonly skills: readonly string[];
}
