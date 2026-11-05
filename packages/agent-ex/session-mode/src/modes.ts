// 模式的归一化与装配期校验：一个模式就是"一段提示词 + 一组能力开关"，`modes.<id>` 声明它们。
// 装配期 fail loud：写错的名单、缺字段的默认模型、退役的写法都在启动时拒绝，而不是等到某个会话装配提示词。
import type { ModeConfig, SessionModeModel } from "./endpoint/mode-config.ts";
import { derivedSkills } from "./endpoint/mode-config.ts";
import { POLICY_NAMES, type PolicyName } from "./endpoint/session-mode-shapes.ts";

// 一个模式的源形状：配置里能省略哪些字段看 `normalizeMode` 的补默认。
export interface ModeInput {
  readonly presetsOnly?: readonly string[];
  readonly name?: string;
  readonly description?: string;
  readonly role?: readonly string[];
  readonly persona?: { readonly prefix?: string; readonly suffix?: string };
  readonly allowTools?: readonly string[];
  readonly denyTools?: readonly string[];
  readonly allowSkills?: readonly string[];
  readonly denySkills?: readonly string[];
  readonly allowPolicies?: readonly string[];
  readonly denyPolicies?: readonly string[];
  readonly instructions?: boolean;
  readonly skills?: boolean;
  readonly dropSections?: readonly string[];
  readonly runtimeContext?: boolean;
  readonly defaultModel?: Partial<SessionModeModel> | null;
  // 退役字段：单个 `preset` 已换成白名单 `presetsOnly`。留着只为报错。
  readonly preset?: string;
}

// 一份模式输入 → 归一化后的形状（每个字段都有值）：内置默认与 `{dshHome}/modes/*.toml` 覆盖都走这条。
export function normalizeMode(input: ModeInput): ModeConfig {
  const allowTools = [...(input.allowTools ?? [])];
  const denyTools = [...(input.denyTools ?? [])];
  const model = input.defaultModel;
  return {
    presetsOnly: [...(input.presetsOnly ?? [])],
    name: input.name ?? "",
    description: input.description ?? "",
    role: (input.role ?? ["main"]).filter(
      (role): role is "main" | "subagent" => role === "main" || role === "subagent",
    ),
    persona: { prefix: input.persona?.prefix ?? "", suffix: input.persona?.suffix ?? "" },
    allowTools,
    denyTools,
    allowSkills: [...(input.allowSkills ?? [])],
    denySkills: [...(input.denySkills ?? [])],
    allowPolicies: [...(input.allowPolicies ?? [])],
    denyPolicies: [...(input.denyPolicies ?? [])],
    instructions: input.instructions ?? true,
    skills: input.skills ?? derivedSkills({ allowTools, denyTools }),
    dropSections: [...(input.dropSections ?? [])],
    runtimeContext: input.runtimeContext ?? true,
    ...(model === undefined || model === null
      ? {}
      : {
          defaultModel: {
            provider: model.provider ?? "",
            model: model.model ?? "",
            ...(model.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: model.reasoningEffort }),
          },
        }),
  };
}

const POLICY_NAME_SET: ReadonlySet<string> = new Set(POLICY_NAMES);

// 校验要看的那几件事：默认模式、每个模式的角色与两份 policy 名单、默认模型、退役字段。
export interface ModeConfigInput {
  readonly default: string;
  readonly modes: Readonly<Record<string, ModeInput>>;
  // 退役的顶层形状（默认模型住在各自的模式里）：还配着值就报错，别让它静静地失效。
  readonly models?: Readonly<Record<string, unknown>>;
}

// 模式定义里不合法的地方（装配期 fail loud）。
export function configProblem(config: ModeConfigInput): string | undefined {
  const ids = Object.keys(config.modes);
  if (ids.length === 0) return "session-mode: `modes` must declare at least one mode";
  if (!ids.includes(config.default)) {
    return `session-mode: \`default\` names ${JSON.stringify(config.default)}, which is not in modes (${ids.join(", ")})`;
  }
  const roles = (id: string): readonly string[] => config.modes[id]?.role ?? ["main"];
  const roleless = ids.filter((id) => roles(id).length === 0);
  if (roleless.length > 0) {
    return `session-mode: mode(s) ${roleless.join(", ")} declare no \`role\`; declare main and/or subagent instead of leaving it empty`;
  }
  if (!roles(config.default).includes("main")) {
    return `session-mode: \`default\` names ${JSON.stringify(config.default)}, which does not declare role "main"; a session that can never be re-selected is a contradiction`;
  }
  // 退役的顶层 `models`：默认模型已经住进各模式的 `defaultModel`，还配着值就拒绝装载。
  if (Object.keys(config.models ?? {}).length > 0) {
    return "session-mode: `models` has moved into each mode's `defaultModel`; move the entries there and drop the top-level `models`";
  }
  const unknownPolicies = Object.entries(config.modes).flatMap(([id, mode]) =>
    [...(mode.allowPolicies ?? []), ...(mode.denyPolicies ?? [])]
      .filter((policy) => !POLICY_NAME_SET.has(policy))
      .map((policy) => `${id}: ${policy}`),
  );
  if (unknownPolicies.length > 0) {
    return `session-mode: mode(s) ${unknownPolicies.join(", ")} name unknown policies; the known ones are ${POLICY_NAMES.join(", ")}`;
  }
  const retired = Object.entries(config.modes)
    .filter(([, mode]) => mode.preset !== undefined)
    .map(([id]) => id);
  if (retired.length > 0) {
    return `session-mode: mode(s) ${retired.join(", ")} still declare \`preset\`; it has moved to \`presetsOnly\` (the presets that mode may ride on)`;
  }
  const partial = Object.entries(config.modes)
    .filter(([, mode]) => {
      const model = mode.defaultModel;
      if (model === undefined || model === null) return false;
      return (model.provider ?? "").length === 0 || (model.model ?? "").length === 0;
    })
    .map(([id]) => id);
  if (partial.length > 0) {
    return `session-mode: mode(s) ${partial.join(", ")} declare \`defaultModel\` without both \`provider\` and \`model\``;
  }
  return undefined;
}

// 一条 policy 规则在这份配置里还生效吗（deny 优先；白名单留空 = 全部生效）。
export function policyInForce(mode: ModeConfig, policy: PolicyName): boolean {
  if (mode.denyPolicies.includes(policy)) return false;
  return mode.allowPolicies.length === 0 || mode.allowPolicies.includes(policy);
}
