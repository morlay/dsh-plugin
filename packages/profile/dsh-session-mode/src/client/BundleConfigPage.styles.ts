// bundle 配置页的样式：**只留这一页自己的结构布局**（卡片、分组、模式头、诊断行、添加行）。
//
// 控件一律从 `@morlay/dsh-client-ui-primitives/client` 取——它转出官方那套基础组件（`Button` / `DisclosureRow` /
// `Input` / `Modal` / `Switch` / `SegmentedControl` / 图标 …），并给出这套设置面自有的控件（字段行
// `SettingsFieldRow`、选择器 `SelectMenu`、标签输入 `TagInput`、多行文本 `MultilineField`、图标按钮 `IconButton`）。
// 控件的外观归 primitives，业务层不写。

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
  modeCard: {
    display: "flex",
    flexDirection: "column",
    padding: "4px 12px 8px",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: "10px",
    background: "var(--dsw-alias-bg-base)",
    flex: "none",
  },
  // 折叠行的文本容器：在行里撑开（否则右侧那一组贴不到最右）。
  disclosureRoot: {
    flex: "1 1 auto",
    minWidth: "0",
  },
  // 折叠行内部：标题与右侧的摘要/删除在同一行，右侧那一组贴最右。
  disclosureContent: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minWidth: "0",
  },
  modeHeadAside: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    marginLeft: "auto",
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
  // 受保护的模式在头部给一句说明（与删除按钮同一个位置）。
  protectedNote: {
    fontSize: "12px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-tertiary)",
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
  // 角色那两个按钮一行。
  roles: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
  },
  // 与官方输入框同高（`Input.module.css` 的 32px）：同行摆的控件高度必须一致。
  controlHeight: {
    height: "32px",
  },
  // 危险动作的配色只在确认那一刻出现：确认按钮把 primary 的填充换成错误色。
  dangerFill: {
    "--dsw-alias-button-primary-fill": "var(--dsw-alias-state-error-primary)",
  },
  // 诊断行：异常态才出现，等宽小字。
  diagnosis: {
    margin: "0",
    fontFamily: "monospace",
    fontSize: "11px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-tertiary)",
    wordBreak: "break-all",
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
} satisfies Record<string, CSSProps>;

export const props = styling.props;

export const className = styling.className;
