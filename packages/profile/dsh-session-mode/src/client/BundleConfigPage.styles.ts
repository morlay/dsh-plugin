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
    lineHeight: "18px",
    color: "var(--dsw-alias-label-error, var(--dsw-alias-label-primary))",
  },
  // 多行文本：官方表单没有这个控件，按官方输入框的 token 画。
  multiline: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "64px",
    padding: "5px 8px",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "20px",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-base)",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: "6px",
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
    gap: "8px",
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
  // 非文本控件的字段块：标签一行、控件一行、说明一行。
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  fieldLabel: {
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  fieldHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  fieldHint: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  roles: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  tags: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
  },
  tagItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
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
  tagRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    maxWidth: "420px",
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
  defaultRow: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxWidth: "320px",
  },
} satisfies Record<string, CSSProps>;

export const props = styling.props;

export const className = styling.className;
