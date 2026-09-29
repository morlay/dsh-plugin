// 本包作为能力包发布的**装配数据**：`session-mode` 行的 config（各模式的会话级扩展）由这里渲染，
// 装配入口在 `packages/bundles/session-mode-profile`（它同时装注入通道、工具说明与 subagent 那几行）。

import { DEFAULT_MODE, MODE_SOURCES, type ModeSource } from "./mode-sources.ts";

// 装配入口要拿这个 id 声明 preset 行（`preset-<id>` 的行 id 与 `config.id` 都用它）：与模式里的 `preset`
// 是同一个事实，所以只有一份。
export { MODE_PRESET_ID } from "./mode-sources.ts";

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

// 一个模式的源定义 → 行 config（schema 的输入形状：可省的字段就省）。
function modeConfig(source: ModeSource): Record<string, unknown> {
  return {
    preset: source.preset,
    name: source.name,
    description: source.description,
    ...(source.role === undefined ? {} : { role: [...source.role] }),
    ...(source.persona === undefined ? {} : { persona: { ...source.persona } }),
    allowTools: [...source.allowTools],
    ...(source.instructions === undefined ? {} : { instructions: source.instructions }),
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
