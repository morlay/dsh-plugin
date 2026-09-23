/**
 * 卡片样式：只管布局与那几个控件，颜色 / 圆角 / 焦点环跟共享原语（`SettingsForm` / `SettingsValueField`）
 * 同源——用官方的 `--dsw-*` token（`dsw` 助手给出变量名，写错名字是类型错误），这样它跟别的插件卡片长得一样。
 */

import type { CSSProps } from "@morlay/dsh-client-ui-primitives/client";
import { dsw } from "@morlay/dsh-client-ui-primitives/client";

export const styles = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  heading: {
    margin: "0",
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "600",
    color: dsw.alias.label.primary,
  },
  hint: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.label.tertiary,
  },
  // 两条提示都不是错：读不到目录只影响"能不能改"，当前值与恢复默认仍然可用。
  notice: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.state.warn.label,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  // 一个模式一行：窄到放不下时那几个选择器各自占一行。
  row: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 12px",
    border: `0.5px solid ${String(dsw.alias.border.l2)}`,
    borderRadius: "8px",
  },
  rowHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  rowName: {
    fontSize: "13px",
    lineHeight: "1.5",
    fontWeight: "500",
    color: dsw.alias.label.primary,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "1px 8px",
    fontSize: "11px",
    lineHeight: "17px",
    background: dsw.alias.bg.module.platform,
    color: dsw.alias.label.secondary,
  },
  // "恢复默认"推到最后：它属于整行，不属于某个选择器。
  reset: {
    marginLeft: "auto",
    border: "none",
    background: "none",
    padding: 0,
    font: "inherit",
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.label.secondary,
    cursor: "pointer",
    "&:hover:not(:disabled)": {
      color: dsw.alias.label.primary,
    },
    "&:disabled": {
      cursor: "default",
    },
  },
  rowHint: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.label.tertiary,
  },
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.label.secondary,
  },
  select: {
    height: "30px",
    padding: "0 8px",
    border: `0.5px solid ${String(dsw.alias.border.l4)}`,
    borderRadius: "8px",
    background: dsw.alias.bg.layer["3"],
    font: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: dsw.alias.label.primary,
    "&:focus-visible": {
      outline: "none",
      borderColor: dsw.alias.brand.primary,
    },
    "&:disabled": {
      color: dsw.alias.label.tertiary,
      cursor: "default",
    },
  },
  invalid: {
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.state.error.primary,
  },
} satisfies Record<string, CSSProps>;
