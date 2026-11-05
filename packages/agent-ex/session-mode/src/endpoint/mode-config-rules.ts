// 两份纯函数：配置 + 会话覆盖 → 生效配置；面板草稿 → 会话覆盖差异。
// 会话覆盖是**全量**的一份 `ModeConfig`，不是字段级 merge——面板的 ViewModel 就是它。
import type { ModeConfig } from "./mode-config.ts";

export function resolveModeConfig(config: ModeConfig, session: ModeConfig | undefined): ModeConfig {
  return structuredClone(session ?? config);
}

// 全量比较：不同 → 整份 ViewModel 作为覆盖；相同 → 没有覆盖。
export function diffModeConfig(config: ModeConfig, view: ModeConfig): ModeConfig | undefined {
  return JSON.stringify(config) === JSON.stringify(view) ? undefined : structuredClone(view);
}

// 面板草稿：三态按"组引用 / 条目 id"记录；`unset` = 从两边名单里都移除。
export interface ModeDraft {
  readonly lists?: Readonly<
    Record<"tools" | "skills" | "policies", Readonly<Record<string, "allow" | "deny" | "unset">>>
  >;
  readonly persona?: { prefix: string; suffix: string } | null;
  readonly switches?: Readonly<Record<string, boolean | null>>;
}

// ViewModel 的修改 → 符合预期的 `ModeConfig`（`defaults` 是"回到默认"时的取值基座）。
export function applyDraft(
  config: ModeConfig,
  draft: ModeDraft,
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
        // 空白名单 = 全放行：点"允许"只从 deny 里移除，不写 allow（写了就把配置变成"只允许它"）。
        if (allow.size > 0) allow.add(id);
      } else {
        allow.delete(id);
        deny.delete(id);
      }
    }
    view[allowKey] = [...allow];
    view[denyKey] = [...deny];
  }
  if (draft.persona !== undefined && draft.persona !== null) view["persona"] = draft.persona;
  for (const [key, value] of Object.entries(draft.switches ?? {})) {
    if (value !== null) view[key] = value;
    else if (defaults !== undefined)
      view[key] = (defaults as unknown as Record<string, unknown>)[key];
  }
  return view as unknown as ModeConfig;
}
