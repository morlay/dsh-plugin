/**
 * 设置页「子代理」卡片的文案：命名空间 `settings.subagent`（与 index.ts 注册时用的 key 一致）。
 *
 * 上游那张卡片把「运行限制」与「模型白名单」放在一页；这里只有限额一段（模型统一由 session mode 的
 * 顶层 `models`（各模式的默认模型）决定，所以白名单那套行已被 patch 停掉），因此文案也只留这一段真正用到的句子。
 */

import type { SettingsFormLabels } from "@morlay/dsh-client-ui-primitives/client";

/** 中文文案（部署语言偏好是 zh）。 */
export const zh = {
  overridden: "已覆盖",
  reset: "恢复默认",
  readOnly: "本部署的设置为只读。",
  unavailable: "该插件当前未加载，暂时无法配置。",
  save: "保存",
  saving: "保存中…",
  saveFailed: "本部署没有接受这些值，已保留供你修改。",
  subagentTitle: "子代理",
  subagentDescription: "设置子代理的递归深度与并行上限。",
  subagentLimitsTitle: "运行限制",
  subagentMaxDepth: "最大递归深度",
  subagentDepthHelpLabel: "最大递归深度说明",
  subagentDepthHelp:
    "限制 Agent 创建子代理的递归层级：「0」禁用子代理，「1」只允许主 Agent 创建子代理，更大的值放开到该层数。某个工具若自带最大深度，以该工具的设置为准。",
  subagentMaxActive: "子代理并行数量上限",
  subagentCapacityHelpLabel: "子代理并行数量上限说明",
  subagentCapacityHelp:
    "同一主 Agent 下，所有递归层级同时存活的子代理总数，主 Agent 不计入。达到上限时，新的启动请求会被拒绝。",
  subagentDepthInvalid: "请输入不小于 0 的整数。",
  subagentCapacityInvalid: "请输入不小于 1 的整数。",
};

/** 本卡片渲染的文案 key。 */
export type SubagentSettingsLocaleKey = keyof typeof zh;

/** 英文文案。 */
export const en: Record<SubagentSettingsLocaleKey, string> = {
  overridden: "Overridden",
  reset: "Reset to default",
  readOnly: "This deployment stores settings read-only.",
  unavailable: "This plugin is not loaded, so it cannot be configured right now.",
  save: "Save",
  saving: "Saving…",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  subagentTitle: "Subagent",
  subagentDescription: "Set Subagent recursion depth and parallelism limit.",
  subagentLimitsTitle: "Limits",
  subagentMaxDepth: "Maximum recursion depth",
  subagentDepthHelpLabel: "About maximum recursion depth",
  subagentDepthHelp:
    'Limits how many levels of Subagents an Agent can create: "0" disables Subagents, "1" lets only the main Agent create them, and a larger value opens that many levels. A tool that sets its own maximum depth takes precedence.',
  subagentMaxActive: "Subagent parallelism limit",
  subagentCapacityHelpLabel: "About the Subagent parallelism limit",
  subagentCapacityHelp:
    "Total live Subagents under the same main Agent, across all recursion levels. The main Agent is excluded. New start requests are rejected when the limit is reached.",
  subagentDepthInvalid: "Enter a whole number of 0 or more.",
  subagentCapacityInvalid: "Enter a whole number of 1 or more.",
};

/**
 * 表单外框的文案，从本页字典里读。
 * @param t - 本页的字典读取器。
 * @returns 共享设置表单渲染用的标签。
 */
export function formLabels(t: (key: SubagentSettingsLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving"),
  };
}
