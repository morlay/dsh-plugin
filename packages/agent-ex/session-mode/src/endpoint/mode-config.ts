// 模式配置的唯一模型：与 `{dshHome}/modes/<id>.toml` 同构，也是面板与 wire 上走的那一份。
// 字段全部必填（`defaultModel` 除外）：读进来的部分配置先归一到这个形状，下游才不会读到 `undefined`。

export type SessionModeRole = "main" | "subagent";

// 模式的默认模型；省略的字段跟 provider 默认（与全局 `agent-default-model` 同形状）。
export interface SessionModeModel {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

export interface SessionModePersona {
  readonly prefix: string;
  readonly suffix: string;
}

export interface ModeConfig {
  // 这个模式只允许挂哪些 agent preset；留空 = 不限制（选这个模式不换 preset）。
  readonly presetsOnly: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly role: readonly SessionModeRole[];
  readonly persona: SessionModePersona;
  // 工具白名单；留空 = 不设收窄。
  readonly allowTools: readonly string[];
  // 工具黑名单：从上面那份里减掉（deny 优先）。
  readonly denyTools: readonly string[];
  readonly allowSkills: readonly string[];
  readonly denySkills: readonly string[];
  // 上游 policy 规则的生效白名单；留空 = 全部生效。
  readonly allowPolicies: readonly string[];
  readonly denyPolicies: readonly string[];
  // 是否要 instruction 类注入（官方工作区指令 + 通道的降级注入）。
  readonly instructions: boolean;
  // 是否要技能目录；不写就按工具名单推导（见 `derivedSkills`）。
  readonly skills: boolean;
  // 这个模式下要丢弃的 system prompt section（精确名，或以 `*` 结尾的前缀）。
  readonly dropSections: readonly string[];
  // 是否要动态快照（沙箱 / 审批策略）与时钟注入。
  readonly runtimeContext: boolean;
  readonly defaultModel?: SessionModeModel;
}

// 一份模式定义 → 完整 `ModeConfig`：`skills` 缺省时由调用方按这份定义自己的工具名单推导（`derivedSkills`）。
// 面板与 `activeState` 都经它，于是下游读到的永远是解析后的布尔。
export function asModeConfig(
  mode: Omit<ModeConfig, "skills"> & { readonly skills?: boolean },
  skills: boolean,
): ModeConfig {
  return { ...mode, skills } as ModeConfig;
}

// `skills` 不写时的推导：起点是白名单（留空 = 全部工具，含 `skill`），减去黑名单，还留着 `skill` 就要目录。
export function derivedSkills(mode: Pick<ModeConfig, "allowTools" | "denyTools">): boolean {
  const allowed = mode.allowTools.length === 0 || mode.allowTools.includes("skill");
  return allowed && !mode.denyTools.includes("skill");
}
