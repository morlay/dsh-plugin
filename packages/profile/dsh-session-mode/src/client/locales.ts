/**
 * client 半的文案：命名空间 `session-mode`（与 locale 注册时用的 key 一致）。
 *
 * 只留这一面真正用到的几句——模式的名字与说明由 host 的清单给（那是数据，不是文案）。
 */

export const zh = {
  seatHint: "选择这个会话的模式",
  headerHint: "这个会话运行的模式",
  noDescription: "（无说明）",
  switchRefused: "切换失败：{reason}",
  loadFailed: "读不到模式清单",
};

export const en = {
  seatHint: "Pick the mode for this session",
  headerHint: "The mode this session runs",
  noDescription: "(no description)",
  switchRefused: "Switch refused: {reason}",
  loadFailed: "Could not load the mode roster",
};

export type SessionModeLocaleKey = keyof typeof zh;
