// bundle 配置页的样式（官方 `--dsw-*` 变量 + 我们的 css-in-js 层）。
//
// 页面本体是"默认模式 + 一串模式卡片"：卡片头是通用折叠行（官方 `DisclosureRow`），卡片内按分组摆「左标签 + 右控件」，
// 控件用原生元素补官方 primitives 没有的形状（多行文本、下拉），外观与官方输入保持一致（同一套 token）。

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
  // 原生控件（多行文本 / 下拉）：与官方 `Input` 同一套 token。
  control: {
    boxSizing: "border-box",
    width: "100%",
    padding: "5px 8px",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "20px",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-base)",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: "6px",
  },
  select: {
    boxSizing: "border-box",
    width: "100%",
    padding: "5px 8px",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "20px",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-base)",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: "6px",
    cursor: "pointer",
  },
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
    gap: "6px",
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
  field: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  },
  fieldLabel: {
    flex: "0 0 150px",
    fontSize: "12px",
    lineHeight: "20px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  fieldBody: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1 1 auto",
    minWidth: "0",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "6px",
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  roles: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
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
