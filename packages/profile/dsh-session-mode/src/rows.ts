// 本包作为能力包发布的**装配数据**：`session-mode` 行的 config（各模式的会话级扩展）由这里渲染，
// 装配入口在 `packages/bundles/session-mode-profile`（它同时装注入通道、工具说明与 subagent 那几行）。

import { DEFAULT_MODE, MODE_SOURCES, type ModeSource } from "./mode-sources.ts";

// 一行装配条目：与 `cordis.patch.yml` 的顶层结构同形。
export interface PatchRow {
  readonly insert?: readonly RowEntry[];
}

// `insert` 里的一个条目。
export interface RowEntry {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

// 一份名单：留空（或没写）就不进 config——空数组与不写同义，行 config 里不留空键。
function list<T>(values: readonly T[] | undefined): readonly T[] | undefined {
  return values === undefined || values.length === 0 ? undefined : [...values];
}

// 一个模式的源定义 → 行 config（schema 的输入形状：可省的字段就省）。
function modeConfig(source: ModeSource): Record<string, unknown> {
  const allowTools = list(source.allowTools);
  const denyTools = list(source.denyTools);
  const allowPolicies = list(source.allowPolicies);
  const denyPolicies = list(source.denyPolicies);
  return {
    // `preset` 是可选的：不写就是不绑（行 config 里也不出现这个键，schema 默认空串）。
    ...(source.preset === undefined ? {} : { preset: source.preset }),
    name: source.name,
    description: source.description,
    ...(source.role === undefined ? {} : { role: [...source.role] }),
    ...(source.persona === undefined ? {} : { persona: { ...source.persona } }),
    // 四份名单都是可选的：不写（或写成空数组）就是这个键不进 config，schema 默认空数组。
    // `allowTools` 不写 = 不设收窄；`denyTools` 不写 = 一件都不禁（两份同配时 deny 优先）；
    // `allowPolicies` 不写 = 全部上游 policy 规则生效；`denyPolicies` 不写 = 一条都不禁。
    ...(allowTools === undefined ? {} : { allowTools }),
    ...(denyTools === undefined ? {} : { denyTools }),
    ...(allowPolicies === undefined ? {} : { allowPolicies }),
    ...(denyPolicies === undefined ? {} : { denyPolicies }),
    ...(source.instructions === undefined ? {} : { instructions: source.instructions }),
    // `skills` 不写就是不进 config：缺省由这份定义自己的工具名单推导（写成 `false` 才落进 config）。
    ...(source.skills === undefined ? {} : { skills: source.skills }),
    ...(source.runtimeContext === undefined ? {} : { runtimeContext: source.runtimeContext }),
    ...(source.defaultModel === undefined ? {} : { defaultModel: { ...source.defaultModel } }),
  };
}

// `session-mode` 行的装配：默认模式与各模式的扩展定义。
export function sessionModeRows(): readonly PatchRow[] {
  return [
    {
      insert: [
        {
          id: "session-mode",
          name: "@morlay/dsh-session-mode",
          config: {
            default: DEFAULT_MODE,
            modes: Object.fromEntries(
              MODE_SOURCES.map((source) => [source.id, modeConfig(source)]),
            ),
          },
        },
      ],
    },
  ];
}
