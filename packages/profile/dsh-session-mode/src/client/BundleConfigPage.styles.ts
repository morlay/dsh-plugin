// bundle 配置页的样式：布局与容器归这里，控件本身一律用官方 primitives（`SettingsValueField` / `Checkbox` /
// `SegmentedControl` / `Menu` / `Input` / `Tag` / `Button`）——视觉与上游设置面同一套。
//
// 唯一自造外观的是多行文本：官方通用表单只有单行 `SettingsValueField`，而 persona 是多行文本。它按官方输入框的
// token 画（边框 / 圆角 / 字号 / 内距），不再另立一套。

import { styling, type CSSProps } from "@morlay/dsh-client-ui-primitives/client";

export const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  sectionTitle: {
    margin: "0",
    fontSize: "13px",
    lineHeight: "20px",
    fontWeight: "600",
    color: "var(--dsw-alias-label-primary)",
  },
  hint: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  invalid: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-state-error-primary)",
  },
  // 多行文本：官方表单没有这个控件，按官方输入框（`fields.module.css` 的 `.input`）的数值画。
  multiline: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "64px",
    padding: "6px 12px",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-layer-3)",
    border: "0.5px solid var(--dsw-alias-border-l4)",
    borderRadius: "var(--dsw-radius-md)",
    resize: "vertical",
  },
  modeCard: {
    display: "flex",
    flexDirection: "column",
    padding: "4px 12px 8px",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: "10px",
    background: "var(--dsw-alias-bg-base)",
    flex: "none",
  },
  modeSummary: {
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  modeId: {
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  modeBody: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "8px 0 4px",
  },
  modeMeta: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  modeFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "0",
  },
  groupHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  groupTitle: {
    fontSize: "12px",
    lineHeight: "18px",
    fontWeight: "600",
    color: "var(--dsw-alias-label-secondary)",
  },
  // 字段容器：只负责分隔线与留白口径。文本字段用官方 `SettingsValueField`（它自带 `padding: 12px 0`），
  // 其余字段的内层用 `fieldBody` 给同样的 12px —— 两种字段在页面上因此上下留白与分隔完全一致。
  field: {
    display: "flex",
    flexDirection: "column",
  },
  fieldDivider: {
    borderTop: "0.5px solid var(--dsw-alias-border-l2)",
  },
  fieldBody: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px 0",
  },
  // 开关 / 三态 / 多选按钮这一类"右侧控件"的字段：标签与说明在左，控件贴最右。
  fieldInline: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "12px 0",
  },
  fieldText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: "0",
  },
  // 标签与说明的数值取自官方 `fields.module.css`（`.label` 13px/wt500、`.hint` 12px/tertiary）。
  fieldLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-primary)",
  },
  fieldHint: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-tertiary)",
  },
  roles: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
  },
  tags: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  tagItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  tagRemove: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    color: "var(--dsw-alias-label-tertiary)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    lineHeight: "1",
  },
  // 输入框与候选按钮一行；输入框吃掉剩余宽度（占位文案不再被截成一条缝）。
  tagRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
  },
  tagInput: {
    flex: "1 1 auto",
    minWidth: "240px",
  },
  // 危险动作：描边按钮用错误色 + 错误色 hover；确认按钮把 primary 的填充换成错误色。
  dangerOutline: {
    color: "var(--dsw-alias-state-error-primary)",
    borderColor: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent)",
    "--dsw-alias-interactive-bg-hover":
      "color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)",
  },
  dangerFill: {
    "--dsw-alias-button-primary-fill": "var(--dsw-alias-state-error-primary)",
  },
  addRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  addInput: {
    width: "200px",
    flex: "0 0 auto",
  },
  // 默认模式这一行是左右布局：左侧标签与说明，右侧选择器。
  defaultRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  defaultText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "12px 0",
    minWidth: "0",
  },
} satisfies Record<string, CSSProps>;

export const props = styling.props;

export const className = styling.className;
