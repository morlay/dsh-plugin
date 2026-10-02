// client 半的文案：命名空间 `session-mode`（与 locale 注册时用的 key 一致）。模式的名字与说明由 host 的清单给
// （那是数据，不是文案）；本行配置页的文案在通用 schema 表单自己的字典里。

export const zh = {
  seatHint: "选择这个会话的模式",
  lockedHint: "这个会话已经开始：换模式请新开一个会话",
  noDescription: "（无说明）",
  provider: "服务商",
  providerHint:
    "服务商 id：部署里注册的任意路由——不论哪个适配器插件注册的（官方的、我们自己的都算）。",
  model: "模型",
  modelHint: "模型 id。",
  reasoningEffort: "思考档位",
  reasoningEffortHint: "默认就跟服务商自己的默认。",
};

export const en: Record<keyof typeof zh, string> = {
  seatHint: "Pick the mode for this session",
  lockedHint: "This session has started: start a new one to pick a mode",
  noDescription: "(no description)",
  provider: "Provider",
  providerHint:
    "Provider id: any route registered in this deployment, whichever adapter plugin supplies it.",
  model: "Model",
  modelHint: "Model id.",
  reasoningEffort: "Reasoning effort",
  reasoningEffortHint: "Default keeps the provider's own default.",
};

export type SessionModeLocaleKey = keyof typeof zh;
