/**
 * client 半的文案：命名空间 `session-mode`（与 locale 注册时用的 key 一致）。
 *
 * 只有会话里的两个面（模式 chip 与头部标签）用这份字典：模式的名字与说明由 host 的清单给（那是数据，不是
 * 文案）。本行的配置页（各模式的默认模型）由通用 schema 表单渲染，文案在它自己的字典里。
 */

export const zh = {
  seatHint: "选择这个会话的模式",
  headerHint: "这个会话运行的模式",
  noDescription: "（无说明）",
  provider: "服务商",
  providerHint: "服务商 id：`llm-openai-compatible` 的 providers 里的键，或内置服务商名。",
  model: "模型",
  modelHint: "模型 id。",
  reasoningEffort: "思考档位",
  reasoningEffortHint: "省略就跟服务商自己的默认。",
};

export const en: Record<keyof typeof zh, string> = {
  seatHint: "Pick the mode for this session",
  headerHint: "The mode this session runs",
  noDescription: "(no description)",
  provider: "Provider",
  providerHint:
    "Provider id: a key in `llm-openai-compatible`'s providers, or a built-in provider name.",
  model: "Model",
  modelHint: "Model id.",
  reasoningEffort: "Reasoning effort",
  reasoningEffortHint: "Unset keeps the provider's own default.",
};

export type SessionModeLocaleKey = keyof typeof zh;
