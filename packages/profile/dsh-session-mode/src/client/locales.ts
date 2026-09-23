/**
 * client 半的文案：命名空间 `session-mode`（与 locale 注册时用的 key 一致）。
 *
 * 两个面共用这一份字典：会话里的两个槽位（模式 chip 与头部标签）与设置页那张卡片。模式的名字与说明由
 * host 的清单给（那是数据，不是文案）。
 */

import type { SettingsFormLabels } from "@morlay/dsh-client-ui-primitives/client";

export const zh = {
  seatHint: "选择这个会话的模式",
  headerHint: "这个会话运行的模式",
  noDescription: "（无说明）",
  switchRefused: "切换失败：{reason}",
  loadFailed: "读不到模式清单",
  cardTitle: "会话模式",
  cardDescription: "给每个会话模式指定默认模型；不指定就跟全局默认模型。",
  defaultsTitle: "各模式的默认模型",
  defaultsHint:
    "只在会话还没有模型事实（没选过模型、也还没跑过请求）时生效；留空就是跟全局默认模型。改完按下面的保存写进设置。",
  providerLabel: "服务商",
  modelLabel: "模型",
  effortLabel: "思考档位",
  inheritOption: "跟全局默认",
  chooseModel: "选择模型…",
  effortDefaultOption: "跟模型默认",
  staleOption: "{value}（不在目录里）",
  overridden: "已覆盖",
  reset: "恢复默认",
  modelRequired: "还没选模型",
  readOnly: "本部署的设置为只读。",
  unavailable: "本插件当前未加载，暂时无法配置。",
  save: "保存",
  saving: "保存中…",
  saveFailed: "本部署没有接受这些值，已保留供你修改。",
  rosterFailed: "读不到会话模式清单，暂时列不出模式。",
  directoryFailed: "读不到模型目录，暂时只能看当前值或恢复默认。",
  directoryPartial: "这些服务商的目录没读到：{names}",
};

export const en: Record<keyof typeof zh, string> = {
  seatHint: "Pick the mode for this session",
  headerHint: "The mode this session runs",
  noDescription: "(no description)",
  switchRefused: "Switch refused: {reason}",
  loadFailed: "Could not load the mode roster",
  cardTitle: "Session mode",
  cardDescription: "Set the default model of each session mode; unset follows the global default.",
  defaultsTitle: "Default model per mode",
  defaultsHint:
    "Applies only while a session has no model fact yet (no model picked, no request made); unset follows the global default model. Save writes it into the settings document.",
  providerLabel: "Provider",
  modelLabel: "Model",
  effortLabel: "Reasoning effort",
  inheritOption: "Same as global default",
  chooseModel: "Choose a model…",
  effortDefaultOption: "Model default",
  staleOption: "{value} (not in the directory)",
  overridden: "Overridden",
  reset: "Reset to default",
  modelRequired: "No model picked yet",
  readOnly: "This deployment stores settings read-only.",
  unavailable: "This plugin is not loaded, so it cannot be configured right now.",
  save: "Save",
  saving: "Saving…",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  rosterFailed: "Could not load the session mode roster, so no mode can be listed.",
  directoryFailed:
    "Could not read the model directory, so only the current value or a reset is available.",
  directoryPartial: "These providers could not be read: {names}",
};

export type SessionModeLocaleKey = keyof typeof zh;

/**
 * 共享设置表单外框的文案，从本页字典里读。
 * @param t - 本页的字典读取器。
 * @returns `SettingsForm` 渲染用的标签。
 */
export function formLabels(t: (key: SessionModeLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving"),
  };
}
