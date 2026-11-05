// 模式配置的唯一模型：与 `{dshHome}/modes/<id>.toml` 同构。**包括 `session` 列**——会话级覆盖不是另一套
// 逐条目结构，而是同一份 `ModeConfig` 的可覆盖字段子集。TOML 不写 `session`（它属于会话日志）。
//
// 两个边界，测试只写在这两处：
// - `resolveModeConfig(config, session)`：配置 + 会话覆盖 → 生效配置（上下文的过滤与转换就在这一步）；
// - `diffModeConfig(config, view)`：面板的 ViewModel（也是 `ModeConfig` 的编辑副本）→ 会话覆盖差异。

import type { SessionMode } from "./modes.ts";

// 与 TOML 同构的模式配置：`skills` 在 schema 里可选，这里归一成布尔；`session` 是会话列。
// 字段全部必填：TOML 读进来也先归一到这个形状。
export interface ModeConfig {
  readonly presetsOnly: string[];
  readonly name: string;
  readonly description: string;
  readonly role: SessionMode["role"];
  readonly persona: { readonly prefix: string; readonly suffix: string };
  readonly allowTools: string[];
  readonly denyTools: string[];
  readonly allowSkills: string[];
  readonly denySkills: string[];
  readonly allowPolicies: string[];
  readonly denyPolicies: string[];
  readonly instructions: boolean;
  readonly skills: boolean;
  readonly dropSections?: string[];
  readonly runtimeContext: boolean;
}

// 会话覆盖是**全量**的：一份完整配置，不是字段级 merge。
export type ModeSession = ModeConfig;

// 面板的 ViewModel 就是一份 `ModeConfig`：编辑它，"应用到会话"产出一份 `ModeSession`。
export type ModeViewModel = ModeConfig;

// 配置 + 会话覆盖 → 生效配置。数组整体替换（组引用就在数组里，不需要另一套展开语义）。
export function resolveModeConfig(
  config: ModeConfig,
  session: ModeSession | undefined,
): ModeConfig {
  return structuredClone(session ?? config);
}

// 全量比较：ViewModel 与配置相同 → 没有会话覆盖（undefined）；不同 → 整份 ViewModel 作为覆盖。
export function diffModeConfig(config: ModeConfig, view: ModeConfig): ModeSession | undefined {
  return JSON.stringify(config) === JSON.stringify(view) ? undefined : structuredClone(view);
}

// 一份配置在某个会话里的三面：配置本身、会话覆盖、二者叠加的生效配置。

// 把 TOML/行配置读进来的那半归一成完整 `ModeConfig`（`skills` 缺省按工具名单推导由调用方给默认）。
export function asModeConfig(mode: SessionMode, skills: boolean): ModeConfig {
  // schema 产物里字段可能可选，这里统一归一成完整配置。
  return { ...mode, skills } as unknown as ModeConfig;
}

// 面板草稿：三态按"组引用 / 条目 id"记录。`unset` = 从两边名单里都移除。
export interface ModeDraft {
  readonly lists?: Readonly<
    Record<"tools" | "skills" | "policies", Readonly<Record<string, "allow" | "deny" | "unset">>>
  >;
  readonly persona?: { prefix: string; suffix: string } | null;
  readonly switches?: Readonly<Record<string, boolean | null>>;
}

// ViewModel 的修改 → 符合预期的 `ModeConfig`：`denyTools: ["mcp:agent-browser"]` + 草稿 unset → `denyTools: []`。
export function applyDraft(
  config: ModeConfig,
  draft: ModeDraft,
  // 默认基座：`null`（回到默认）时取它的值。省略就是 `config` 自己。
  defaults?: ModeConfig,
): ModeConfig {
  const view: Record<string, unknown> = { ...structuredClone(config) };
  const lists = [
    ["tools", "allowTools", "denyTools"],
    ["skills", "allowSkills", "denySkills"],
    ["policies", "allowPolicies", "denyPolicies"],
  ] as const;
  for (const [kind, allowKey, denyKey] of lists) {
    const allow = new Set(view[allowKey] as string[]);
    const deny = new Set(view[denyKey] as string[]);
    for (const [id, value] of Object.entries(draft.lists?.[kind] ?? {})) {
      if (value === "deny") deny.add(id);
      else if (value === "allow") {
        deny.delete(id);
        if (allow.size > 0) allow.add(id);
      } else {
        // unset = 配置里不写这一项：两边名单都移除。
        allow.delete(id);
        deny.delete(id);
      }
    }
    view[allowKey] = [...allow];
    view[denyKey] = [...deny];
  }
  if (draft.persona !== undefined && draft.persona !== null) view["persona"] = draft.persona;
  for (const [key, value] of Object.entries(draft.switches ?? {})) {
    // `null` = 回到默认：取默认基座（`config`）的那一项，而不是保留会话覆盖里的旧值。
    if (value !== null) view[key] = value;
    else if (defaults !== undefined)
      view[key] = (defaults as unknown as Record<string, unknown>)[key];
  }
  return view as unknown as ModeConfig;
}
